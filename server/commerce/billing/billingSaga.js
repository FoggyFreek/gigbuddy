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
import {
  getPaymentProvider,
  PaymentProviderError,
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
} from './paymentProvider/index.js'
import {
  claimOperation,
  markOperation,
} from './billingOperationRepository.js'
import {
  fetchSubscriptionById,
  fetchUserMollieCustomerId,
  setUserMollieCustomerId,
  setMandateLinkage,
  setScheduleStale,
  setBillingRepairNeeded,
} from './subscriptionRepository.js'
import { listModules } from './subscriptionModuleRepository.js'
import {
  billingWebhookUrl,
  billingRedirectUrl,
  billingMetadata,
  idemKeys,
  periodEndFrom,
  subscriptionDescription,
} from './billingShared.js'
import { logger } from '../../utils/logger.js'

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

// Direct paid-signup checkout: one full combined payment both opens the paid
// period and establishes the mandate (`sequenceType: first`). Trial conversion
// uses createMandateVerificationCheckout below instead.
//
// On a resumed call (op already succeeded) the checkout URL is recovered by
// re-fetching the still-open payment from the provider.
export async function createConversionCheckout(db, sub, { email, name, amountCents, redirect = 'billing' }) {
  const provider = getPaymentProvider()
  const customerId = await ensureCustomerForUser(db, { userId: sub.user_id, email, name })
  const modules = await listModules(db, sub.id)

  const opCtx = {
    userId: sub.user_id,
    subscriptionId: sub.id,
    opType: 'conversion_payment',
    idempotencyKey: idemKeys.conversionPayment(sub.id, amountCents),
  }
  const { skipped, resourceId, result } = await runOp(db, opCtx, async (idempotencyKey) => {
    const created = await provider.createMandatePayment({
      customerId,
      amountCents,
      description: subscriptionDescription(modules, sub.billing_interval),
      idempotencyKey,
      redirectUrl: billingRedirectUrl(redirect),
      webhookUrl: billingWebhookUrl(sub.id),
      metadata: billingMetadata(sub.id, 'conversion'),
    })
    return { resourceId: created.paymentId, checkoutUrl: created.checkoutUrl }
  })

  if (!skipped) {
    await setMandateLinkage(db, sub.id, { firstPaymentId: result.resourceId })
    return { paymentId: result.resourceId, checkoutUrl: result.checkoutUrl }
  }
  const payment = await provider.getPayment(resourceId)
  return { paymentId: resourceId, checkoutUrl: payment.checkoutUrl }
}

// Trial mandate setup: the customer pays only the disclosed verification cent.
// Once it settles, ingestion captures the mandate and creates the real
// subscription schedule with startDate = trial_ends_at.
export async function createMandateVerificationCheckout(db, sub, {
  email, name, redirect = 'billing', amountCents,
}) {
  const provider = getPaymentProvider()
  const customerId = await ensureCustomerForUser(db, { userId: sub.user_id, email, name })

  // A browser retry must resume the existing hosted checkout. The first retry
  // sees mollie_first_payment_id, so relying only on the next outbox key would
  // otherwise create a second verification cent.
  if (sub.mollie_first_payment_id) {
    const existing = await provider.getPayment(sub.mollie_first_payment_id)
    if (existing.status === PAYMENT_STATUS.OPEN && existing.checkoutUrl) {
      return { paymentId: existing.id, checkoutUrl: existing.checkoutUrl }
    }
  }

  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'mandate_verification_payment',
      idempotencyKey: idemKeys.mandateVerification(sub.id, sub.mollie_first_payment_id),
    },
    async (idempotencyKey) => {
      const created = await provider.createMandatePayment({
        customerId,
        amountCents,
        description: 'GigBuddy payment-method verification',
        idempotencyKey,
        redirectUrl: billingRedirectUrl(redirect),
        webhookUrl: billingWebhookUrl(sub.id),
        metadata: billingMetadata(sub.id, 'mandate_verification'),
      })
      return { resourceId: created.paymentId, checkoutUrl: created.checkoutUrl }
    },
  )

  const paymentId = skipped ? resourceId : result.resourceId
  await setMandateLinkage(db, sub.id, { firstPaymentId: paymentId })
  if (!skipped) return { paymentId, checkoutUrl: result.checkoutUrl }
  const payment = await provider.getPayment(paymentId)
  return { paymentId, checkoutUrl: payment.checkoutUrl }
}

// Charge the existing mandate on demand for the prorated difference a mid-cycle
// module add or upgrade owes. The amount is part of the idempotency key — the
// same module change made twice in one period costs different amounts.
export async function chargeModuleChange(db, sub, { audience, planId, amountCents, periodEndIso, modules }) {
  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'module_change_charge',
      idempotencyKey: idemKeys.moduleChangeCharge(sub.id, audience, planId, amountCents, periodEndIso),
    },
    async (idempotencyKey) => {
      const charge = await provider.createOnDemandCharge({
        customerId,
        mandateId: sub.mollie_mandate_id,
        amountCents,
        description: `${subscriptionDescription(modules, sub.billing_interval)} — prorated change`,
        idempotencyKey,
        webhookUrl: billingWebhookUrl(sub.id),
        metadata: billingMetadata(sub.id, 'module_change'),
      })
      return { resourceId: charge.paymentId }
    },
  )
  return { paymentId: skipped ? resourceId : result.resourceId }
}

// Where the provider subscription's first charge lands.
function computeScheduleStart(sub) {
  // A converted subscription always renews at the end of the period it has
  // already paid for, whether the schedule is being created for the first time
  // or replaced at a new amount.
  if (sub.current_period_end) {
    const periodEnd = new Date(sub.current_period_end)
    if (periodEnd > new Date()) return periodEnd
  }
  if (sub.status === 'trialing' && sub.trial_ends_at) {
    const trialEnd = new Date(sub.trial_ends_at)
    if (trialEnd > new Date()) return trialEnd
  }
  return new Date()
}

// Make the remote schedule match local state. Mollie cannot change a running
// subscription's amount, so "repair" always means cancel-and-recreate at
// `next_total_cents`, starting at the current period end. That single mechanism
// now covers every amount change: a module added, a module downgraded or
// removed at the boundary, and a time-limited discount lapsing.
//
// Clears mollie_schedule_stale on full success; a terminal failure flags
// billing_repair_needed (the resolver still locks at period end — bounded).
export async function repairSchedule(db, subId) {
  const sub = await fetchSubscriptionById(db, subId)
  if (!sub || !sub.mollie_schedule_stale || sub.is_complimentary) return
  if (sub.status === 'canceled') { await setScheduleStale(db, subId, false); return }

  const provider = getPaymentProvider()
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  if (!customerId || !sub.mollie_mandate_id) return // not converted yet

  // Nothing left to charge for (every module removed) — cancel the schedule
  // rather than recreating it at zero.
  const amountCents = sub.next_total_cents ?? sub.total_cents
  if (!amountCents || amountCents <= 0) {
    if (sub.mollie_subscription_id) await cancelRemoteSubscription(db, sub)
    await setScheduleStale(db, sub.id, false)
    return
  }

  try {
    const startDate = computeScheduleStart(sub)
    const modules = await listModules(db, sub.id)
    if (sub.mollie_subscription_id) {
      await cancelRemoteSubscription(db, sub)
    }
    const { skipped, resourceId, result } = await runOp(
      db,
      {
        userId: sub.user_id,
        subscriptionId: sub.id,
        opType: 'create_subscription',
        idempotencyKey: idemKeys.createSubscription(sub.id, amountCents, sub.billing_interval, startDate.toISOString()),
      },
      async (idempotencyKey) => {
        const created = await provider.createSubscription({
          customerId,
          mandateId: sub.mollie_mandate_id,
          amountCents,
          interval: sub.billing_interval,
          description: subscriptionDescription(modules, sub.billing_interval),
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

// Cancel a remote subscription (idempotent at the provider). Used by
// repairSchedule (replace) and the cancel flows.
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

// Refund a subscription payment through the outbox, so a crash between the
// local refund row and the provider call resumes instead of silently losing
// the customer's money.
export async function refundSubscriptionPayment(db, sub, { providerPaymentId, amountCents, description }) {
  const provider = getPaymentProvider()
  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'refund_payment',
      idempotencyKey: idemKeys.refundPayment(providerPaymentId, amountCents),
    },
    async (idempotencyKey) => {
      const refund = await provider.refundPayment({
        paymentId: providerPaymentId, amountCents, description, idempotencyKey,
      })
      return { resourceId: refund.refundId, status: refund.status }
    },
  )
  return { refundId: skipped ? resourceId : result.resourceId, status: result?.status ?? null }
}

export { periodEndFrom }
