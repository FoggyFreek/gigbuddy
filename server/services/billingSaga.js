// The remote (provider-touching) half of billing, wrapped in the
// billing_operations outbox so every mutation is durable and resumable:
//
//   claim op row (committed) → provider call → mark succeeded / failed_*
//
// A resumed saga re-claims the same idempotency_key and finds an already
// 'succeeded' row, so it skips the provider call rather than double-charging.
// PaymentProviderError.retryable decides failed_retryable vs failed_terminal.
//
// These functions run OUTSIDE any business transaction (never a remote call in
// a txn). Local column touch-ups after a provider call are narrow single-column
// updates that can't conflict with ingestion's row lock.
import { getPaymentProvider, PaymentProviderError, SUBSCRIPTION_STATUS } from '../billing/paymentProvider/index.js'
import {
  claimOperation,
  markOperation,
} from '../repositories/billingOperationRepository.js'
import {
  fetchSubscriptionById,
  fetchUserMollieCustomerId,
  setUserMollieCustomerId,
  setMandateLinkage,
  setScheduleStale,
  setBillingRepairNeeded,
  applyDowngradeSchedule,
} from '../repositories/subscriptionRepository.js'
import { fetchPlan } from '../repositories/planRepository.js'
import { billingWebhookUrl, billingRedirectUrl, billingMetadata, idemKeys, periodEndFrom } from './billingShared.js'
import { logger } from '../utils/logger.js'

// Run one provider call behind an outbox op. Returns { skipped, resourceId, result }.
async function runOp(db, { userId, subscriptionId, opType, idempotencyKey }, fn) {
  const op = await claimOperation(db, { userId, subscriptionId, opType, idempotencyKey })
  if (op.status === 'succeeded') {
    return { skipped: true, resourceId: op.mollie_resource_id, result: null }
  }
  try {
    const result = await fn(idempotencyKey)
    await markOperation(db, op.id, 'succeeded', { mollieResourceId: result?.resourceId ?? null })
    return { skipped: false, resourceId: result?.resourceId ?? null, result }
  } catch (err) {
    const retryable = err instanceof PaymentProviderError ? err.retryable : true
    const code = err instanceof PaymentProviderError ? err.code : 'unknown'
    await markOperation(db, op.id, retryable ? 'failed_retryable' : 'failed_terminal', { lastErrorCode: code })
    logger.error('billing.op_failed', { err, subscriptionId, opType })
    throw err
  }
}

function planDescription(planSlug, interval) {
  return `GigBuddy ${planSlug} (${interval === 'year' ? 'yearly' : 'monthly'})`
}

// Idempotently ensure a provider customer for the user, memoized on
// users.mollie_customer_id.
export async function ensureCustomerForUser(db, { userId, email, name }) {
  const existing = await fetchUserMollieCustomerId(db, userId)
  const provider = getPaymentProvider()
  const { resourceId, skipped, result } = await runOp(
    db,
    { userId, subscriptionId: null, opType: 'ensure_customer', idempotencyKey: idemKeys.ensureCustomer(userId) },
    async () => {
      const customerId = await provider.ensureCustomer({ email, name, existingCustomerId: existing })
      return { resourceId: customerId }
    },
  )
  const customerId = skipped ? (resourceId ?? existing) : result.resourceId
  if (customerId && customerId !== existing) await setUserMollieCustomerId(db, userId, customerId)
  return customerId
}

// Create the €0.01 mandate-establishing first payment and return its checkout
// URL. On a resumed call (op already succeeded) the URL is recovered by
// re-fetching the still-open payment from the provider.
export async function createMandateCheckout(db, sub, { email, name, amountCents, redirect = 'billing' }) {
  const provider = getPaymentProvider()
  const customerId = await ensureCustomerForUser(db, { userId: sub.user_id, email, name })

  const opCtx = {
    userId: sub.user_id,
    subscriptionId: sub.id,
    opType: 'mandate_payment',
    idempotencyKey: idemKeys.mandatePayment(sub.id),
  }
  const { skipped, resourceId, result } = await runOp(db, opCtx, async (idempotencyKey) => {
    const created = await provider.createMandatePayment({
      customerId,
      amountCents,
      description: 'GigBuddy mandate verification',
      idempotencyKey,
      redirectUrl: billingRedirectUrl(redirect),
      webhookUrl: billingWebhookUrl(sub.id),
      metadata: billingMetadata(sub.id, 'mandate'),
    })
    return { resourceId: created.paymentId, checkoutUrl: created.checkoutUrl }
  })

  if (!skipped) {
    await setMandateLinkage(db, sub.id, { firstPaymentId: result.resourceId })
    return { paymentId: result.resourceId, checkoutUrl: result.checkoutUrl }
  }
  // Resume: recover the checkout URL from the open payment.
  const payment = await provider.getPayment(resourceId)
  return { paymentId: resourceId, checkoutUrl: payment.checkoutUrl }
}

// Charge an existing mandate on demand for an upgrade/interval plan change.
export async function chargePlanChange(db, sub, { planId, planSlug, interval, priceCents }) {
  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  const { skipped, resourceId, result } = await runOp(
    db,
    { userId: sub.user_id, subscriptionId: sub.id, opType: 'plan_change_charge', idempotencyKey: idemKeys.planChangeCharge(sub.id, planId, interval) },
    async (idempotencyKey) => {
      const charge = await provider.createOnDemandCharge({
        customerId,
        mandateId: sub.mollie_mandate_id,
        amountCents: priceCents,
        description: planDescription(planSlug, interval),
        idempotencyKey,
        webhookUrl: billingWebhookUrl(sub.id),
        metadata: billingMetadata(sub.id, 'plan_change'),
      })
      return { resourceId: charge.paymentId }
    },
  )
  return { paymentId: skipped ? resourceId : result.resourceId }
}

// Make the remote schedule match local state. Two cases keyed on whether a
// provider subscription already exists:
//   - none yet (post-mandate initial): create it (trial → startDate=trialEnd;
//     non-trial → immediate).
//   - exists but stale (post plan-change): cancel the old and create a new one
//     at the new amount/interval, starting at the current period end.
// Clears mollie_schedule_stale on full success; a terminal failure flags
// billing_repair_needed (resolver still locks at period end — bounded).
export async function repairSchedule(db, subId) {
  const sub = await fetchSubscriptionById(db, subId)
  if (!sub || !sub.mollie_schedule_stale || sub.is_complimentary) return
  if (sub.status === 'canceled') { await setScheduleStale(db, subId, false); return }

  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  if (!customerId || !sub.mollie_mandate_id) return // mandate not yet confirmed

  try {
    const startDate = computeScheduleStart(sub)
    if (sub.mollie_subscription_id) {
      await cancelRemoteSubscription(db, sub)
    }
    const { skipped, resourceId, result } = await runOp(
      db,
      {
        userId: sub.user_id,
        subscriptionId: sub.id,
        opType: 'create_subscription',
        idempotencyKey: idemKeys.createSubscription(sub.id, sub.price_cents, sub.billing_interval, startDate.toISOString()),
      },
      async (idempotencyKey) => {
        const created = await provider.createSubscription({
          customerId,
          mandateId: sub.mollie_mandate_id,
          amountCents: sub.price_cents,
          interval: sub.billing_interval,
          description: planDescription(sub.plan_slug, sub.billing_interval),
          startDate,
          webhookUrl: billingWebhookUrl(sub.id),
          idempotencyKey,
          metadata: billingMetadata(sub.id, 'schedule'),
        })
        return { resourceId: created.id }
      },
    )
    const providerSubId = skipped ? resourceId : result.resourceId
    if (providerSubId) await setMandateLinkage(db, sub.id, { subscriptionId: providerSubId })
    await setScheduleStale(db, sub.id, false)
    await setBillingRepairNeeded(db, sub.id, false)
  } catch (err) {
    if (err instanceof PaymentProviderError && !err.retryable) {
      await setBillingRepairNeeded(db, subId, true)
      logger.error('billing.repair_needed', { err, subscriptionId: subId })
      return
    }
    throw err // retryable: scheduler tries again next tick
  }
}

// Where the provider subscription's first charge lands.
function computeScheduleStart(sub) {
  if (sub.mollie_subscription_id) {
    // Plan change: next charge at the (already locally-set) period end.
    return sub.current_period_end ? new Date(sub.current_period_end) : periodEndFrom(new Date(), sub.billing_interval)
  }
  if (sub.status === 'trialing' && sub.trial_ends_at) return new Date(sub.trial_ends_at)
  return new Date() // non-trial: charge immediately
}

// Cancel a remote subscription (idempotent at the provider). Used by
// repairSchedule (replace) and the cancel/downgrade flows. `providerSubId`
// defaults to the row's current mollie_subscription_id; the downgrade saga
// passes the immutable superseded id explicitly so a retry after the repoint
// can never cancel the replacement.
export async function cancelRemoteSubscription(db, sub, providerSubId = null) {
  const subscriptionId = providerSubId ?? sub.mollie_subscription_id
  if (!subscriptionId) return
  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  await runOp(
    db,
    { userId: sub.user_id, subscriptionId: sub.id, opType: 'cancel_subscription', idempotencyKey: idemKeys.cancelSubscription(sub.id, subscriptionId) },
    async (idempotencyKey) => {
      // Skip the cancel call ONLY when the provider POSITIVELY reports the
      // subscription canceled. A lookup failure must NOT read as canceled —
      // that would mark this op succeeded while the old subscription keeps
      // charging. On lookup error we proceed to the idempotent cancel: the
      // adapter treats already-canceled as success, and any other failure
      // surfaces as a retryable op for the scheduler.
      const status = await provider.getSubscription({ customerId, subscriptionId })
        .then((s) => s.status)
        .catch(() => null)
      if (status !== SUBSCRIPTION_STATUS.CANCELED) {
        await provider.cancelSubscription({ customerId, subscriptionId, idempotencyKey })
      }
      return { resourceId: subscriptionId }
    },
  )
}

// The paid-downgrade schedule saga: cancel the OLD provider subscription (the
// immutable superseded id captured at confirmation) and create the
// replacement at the pending lower amount, first charge at the current period
// end; then one atomic UPDATE repoints mollie_subscription_id and clears the
// durable downgrade_schedule_pending marker. Every step is an idempotent
// outbox op, so a crash anywhere resumes cleanly from the scheduler.
// Create (or resume) the replacement provider subscription at the pending
// lower amount, first charge at the current period end. Returns its id.
async function createDowngradeReplacement(db, sub, customerId, provider) {
  const pendingPlan = await fetchPlan(db, sub.pending_plan_id)
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null
  // Mollie rejects a startDate in the past; an already-ended period charges
  // immediately (access is fallback-locked anyway until that charge pays).
  const startDate = periodEnd && periodEnd > new Date() ? periodEnd : new Date()
  // The idempotency key uses the STABLE period end (never the clamped
  // "now"), so a retry that crosses the period boundary still matches the
  // original op instead of creating a second replacement.
  const keyStartIso = periodEnd ? periodEnd.toISOString() : 'immediate'
  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'create_subscription',
      idempotencyKey: idemKeys.createSubscription(sub.id, sub.pending_price_cents, sub.pending_billing_interval, keyStartIso),
    },
    async (idempotencyKey) => {
      const created = await provider.createSubscription({
        customerId,
        mandateId: sub.mollie_mandate_id,
        amountCents: sub.pending_price_cents,
        interval: sub.pending_billing_interval,
        description: planDescription(pendingPlan.slug, sub.pending_billing_interval),
        startDate,
        webhookUrl: billingWebhookUrl(sub.id),
        idempotencyKey,
        metadata: billingMetadata(sub.id, 'downgrade'),
      })
      return { resourceId: created.id }
    },
  )
  return skipped ? resourceId : result.resourceId
}

// The pending downgrade was cleared (user cancel / failed-downgrade
// finalize) — or its first charge already activated and repointed —
// while the remote calls were in flight. A row that doesn't own the
// replacement must not be charged by it.
async function cancelUnownedReplacement(db, sub, replacementId) {
  const current = await fetchSubscriptionById(db, sub.id)
  if (current?.mollie_subscription_id === replacementId) return
  try {
    await cancelRemoteSubscription(db, current ?? sub, replacementId)
  } catch (err) {
    await setBillingRepairNeeded(db, sub.id, true)
    throw err
  }
}

export async function scheduleDowngradeReplacement(db, subId) {
  const sub = await fetchSubscriptionById(db, subId)
  if (!sub || !sub.downgrade_schedule_pending || sub.status === 'canceled') return
  if (sub.pending_change_kind !== 'downgrade' || !sub.pending_plan_id) return

  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  if (!customerId || !sub.mollie_mandate_id) return

  try {
    if (sub.superseded_mollie_subscription_id) {
      await cancelRemoteSubscription(db, sub, sub.superseded_mollie_subscription_id)
    }

    const replacementId = await createDowngradeReplacement(db, sub, customerId, provider)
    if (!replacementId) return

    const applied = await applyDowngradeSchedule(db, sub.id, replacementId)
    if (!applied) {
      await cancelUnownedReplacement(db, sub, replacementId)
      return
    }
    await setBillingRepairNeeded(db, sub.id, false)
  } catch (err) {
    if (err instanceof PaymentProviderError && !err.retryable) {
      await setBillingRepairNeeded(db, subId, true)
      logger.error('billing.repair_needed', { err, subscriptionId: subId })
      return
    }
    throw err // retryable: the scheduler's downgrade-schedule task tries again
  }
}
