// The remote (provider-touching) half of billing, wrapped in the
// billing_operations outbox so every mutation is durable and resumable:
//
//   claim op row (committed) → provider call → mark succeeded / failed_*
//
// A resumed saga re-claims the same idempotency_key and finds an already
// 'succeeded' row, so it skips the provider call rather than double-charging.
// ProviderError.retryable decides failed_retryable vs failed_terminal.
//
// These functions run OUTSIDE any business transaction (never a remote call in
// a txn). Local column touch-ups after a provider call are narrow single-column
// updates that can't conflict with ingestion's row lock.
import {
  getPaymentProvider,
} from './paymentProvider/providerFactory.js'
import { ProviderError } from './paymentProvider/ProviderError.js'
import { PAYMENT_STATUS, SCHEDULE_STATUS } from './paymentProvider/statuses.js'
import {
  claimOperation,
} from './billingOperationRepository.js'
import { assertOperationCommand, executeBillingOperation } from './billingOperationService.js'
import {
  fetchSubscriptionById,
  fetchUserMollieCustomerId,
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
async function runOp(db, { userId, subscriptionId, opType, idempotencyKey }, command) {
  const durableCommand = JSON.parse(JSON.stringify(command))
  const op = await claimOperation(db, {
    userId, subscriptionId, opType, idempotencyKey, commandPayload: durableCommand,
  })
  assertOperationCommand(op, durableCommand)
  try {
    return await executeBillingOperation(db, op)
  } catch (err) {
    logger.error('billing.op_failed', { err, subscriptionId, opType })
    throw err
  }
}

// Idempotently ensure a provider customer for the user, memoized on
// users.mollie_customer_id.
export async function ensureCustomerForUser(db, { userId, email, name }) {
  const existing = await fetchUserMollieCustomerId(db, userId)
  const provider = getPaymentProvider()
  if (existing) {
    try {
      return (await provider.getCustomer({ customerId: existing })).id
    } catch (err) {
      if (!(err instanceof ProviderError) || err.code !== 'not_found') throw err
    }
  }
  const { resourceId, skipped, result } = await runOp(
    db,
    { userId, subscriptionId: null, opType: 'ensure_customer', idempotencyKey: idemKeys.ensureCustomer(userId) },
    {
      version: 1,
      method: 'createCustomer',
      args: { email, name },
      completion: { kind: 'linkCustomer', userId },
    },
  )
  return skipped ? (resourceId ?? existing) : result.resourceId
}

// Direct paid-signup checkout: one full combined payment both opens the paid
// period and establishes the mandate (`sequenceType: first`). Trial conversion
// uses createMandateVerificationCheckout below instead.
//
// On a resumed call (op already succeeded) the checkout URL is recovered by
// re-fetching the still-open payment from the provider.
export async function createConversionCheckout(db, sub, {
  email, name, amountCents, priceSnapshot = null, redirect = 'billing',
}) {
  const provider = getPaymentProvider()
  const customerId = await ensureCustomerForUser(db, { userId: sub.user_id, email, name })
  const modules = await listModules(db, sub.id)

  const opCtx = {
    userId: sub.user_id,
    subscriptionId: sub.id,
    opType: 'conversion_payment',
    idempotencyKey: idemKeys.conversionPayment(sub.id, amountCents),
  }
  const { resourceId, result } = await runOp(db, opCtx, {
    version: 1,
    method: 'createCheckoutPayment',
    args: {
      customerId,
      amount: { currency: 'EUR', cents: amountCents },
      description: subscriptionDescription(modules, sub.billing_interval),
      redirectUrl: billingRedirectUrl(redirect),
      webhookUrl: billingWebhookUrl(sub.id),
      metadata: billingMetadata(sub.id, 'conversion'),
    },
    completion: {
      kind: 'linkFirstPayment', subscriptionId: sub.id, paymentKind: 'conversion', amountCents,
      priceSnapshot,
    },
  })

  const paymentId = result?.resourceId ?? resourceId
  if (result?.checkoutUrl) return { paymentId, checkoutUrl: result.checkoutUrl }
  const payment = await provider.getPayment({ paymentId })
  return { paymentId, checkoutUrl: payment.checkoutUrl }
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
    const existing = await provider.getPayment({ paymentId: sub.mollie_first_payment_id })
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
    {
      version: 1,
      method: 'createCheckoutPayment',
      args: {
        customerId,
        amount: { currency: 'EUR', cents: amountCents },
        description: 'GigBuddy payment-method verification',
        redirectUrl: billingRedirectUrl(redirect),
        webhookUrl: billingWebhookUrl(sub.id),
        metadata: billingMetadata(sub.id, 'mandate_verification'),
      },
      completion: {
        kind: 'linkFirstPayment', subscriptionId: sub.id,
        paymentKind: 'mandate_verification', amountCents,
      },
    },
  )

  const paymentId = skipped ? resourceId : result.resourceId
  if (result?.checkoutUrl) return { paymentId, checkoutUrl: result.checkoutUrl }
  const payment = await provider.getPayment({ paymentId })
  return { paymentId, checkoutUrl: payment.checkoutUrl }
}

// Charge the existing mandate on demand for the prorated difference a mid-cycle
// module add or upgrade owes. The amount is part of the idempotency key — the
// same module change made twice in one period costs different amounts.
export async function chargeModuleChange(db, sub, { audience, planId, amountCents, periodEndIso, modules }) {
  const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'module_change_charge',
      idempotencyKey: idemKeys.moduleChangeCharge(sub.id, audience, planId, amountCents, periodEndIso),
    },
    {
      version: 1,
      method: 'createRecurringPayment',
      args: {
        customerId,
        mandateId: sub.mollie_mandate_id,
        amount: { currency: 'EUR', cents: amountCents },
        description: `${subscriptionDescription(modules, sub.billing_interval)} — prorated change`,
        webhookUrl: billingWebhookUrl(sub.id),
        metadata: billingMetadata(sub.id, 'module_change'),
      },
      completion: { kind: 'linkModulePayment', subscriptionId: sub.id, amountCents },
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
    await runOp(
      db,
      {
        userId: sub.user_id,
        subscriptionId: sub.id,
        opType: 'create_subscription',
        idempotencyKey: idemKeys.createSubscription(sub.id, amountCents, sub.billing_interval, startDate.toISOString()),
      },
      {
        version: 1,
        method: 'createSchedule',
        args: {
          customerId,
          mandateId: sub.mollie_mandate_id,
          amount: { currency: 'EUR', cents: amountCents },
          interval: sub.billing_interval,
          description: subscriptionDescription(modules, sub.billing_interval),
          startAt: startDate.toISOString(),
          webhookUrl: billingWebhookUrl(sub.id),
          metadata: billingMetadata(sub.id, 'schedule'),
        },
        completion: { kind: 'linkSchedule', subscriptionId: sub.id },
      },
    )
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) {
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
  // Only skip when the provider positively reports cancellation. A lookup
  // error falls through to the idempotent cancel command.
  const status = await provider.getSchedule({ customerId, scheduleId: subscriptionId })
    .then((schedule) => schedule.status)
    .catch(() => null)
  if (status === SCHEDULE_STATUS.CANCELED) return
  await runOp(
    db,
    { userId: sub.user_id, subscriptionId: sub.id, opType: 'cancel_subscription', idempotencyKey: idemKeys.cancelSubscription(sub.id, subscriptionId) },
    {
      version: 1,
      method: 'cancelSchedule',
      args: { customerId, scheduleId: subscriptionId },
      completion: { kind: 'cancelSchedule', subscriptionId: sub.id },
    },
  )
}

// Refund a subscription payment through the outbox, so a crash between the
// local refund row and the provider call resumes instead of silently losing
// the customer's money.
export async function refundSubscriptionPayment(db, sub, {
  providerPaymentId, amountCents, description, refundIntentId,
}) {
  const { skipped, resourceId, result } = await runOp(
    db,
    {
      userId: sub.user_id,
      subscriptionId: sub.id,
      opType: 'refund_payment',
      idempotencyKey: idemKeys.refundPayment(providerPaymentId, amountCents, refundIntentId),
    },
    {
      version: 1,
      method: 'createRefund',
      args: {
        paymentId: providerPaymentId,
        amount: { currency: 'EUR', cents: amountCents },
        description,
      },
      completion: { kind: 'completeRefund', refundId: refundIntentId },
    },
  )
  return { refundId: skipped ? resourceId : result.resourceId, status: result?.status ?? null }
}

export { periodEndFrom }
