// applyPaymentOutcome — the single funnel every payment outcome (webhook AND
// reconcile) passes through. It runs LOCAL effects only, in one transaction
// under the subscription's row lock; remote follow-ups are deferred to the saga
// layer via returned hints (activate-first). The caller commits, then fires
// best-effort push for freshly-inserted notifications and runs the saga hints.
//
// Idempotency comes for free from three layers:
//   1. the ingestion upsert's transition predicate (a replayed same-status
//      payment is inert → no effect),
//   2. per-covered-period notification dedupe keys,
//   3. the period-advance IS DISTINCT guard.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  fetchSubscriptionById,
  fetchSubscriptionByIdForUpdate,
  fetchUserMollieCustomerId,
  setMandateLinkage,
  setScheduleStale,
  applyConversion,
  advanceSubscriptionPeriod,
  applyModuleChangeActivation,
  markSubscriptionPastDue,
  clearPendingChange,
} from './subscriptionRepository.js'
import {
  fetchInFlightModuleChange,
  listModuleChangesDueAtPeriodEnd,
  applyModuleChange,
  clearModulePendingChange,
  deleteModule,
} from './subscriptionModuleRepository.js'
import { executeModulePurge } from './entitlementPurgeService.js'
import { upsertPaymentOutcome, fetchPaymentByMollieId } from './subscriptionPaymentRepository.js'
import { dispatchUserNotification, pushUserNotification } from '../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../domain/notificationTypes.js'
import { periodEndFrom, MANDATE_VERIFICATION_CENTS } from './billingShared.js'
import { getPaymentProvider } from './paymentProvider/providerFactory.js'
import { PAYMENT_STATUS } from './paymentProvider/statuses.js'
import { repriceAndRepairSchedule, repairScheduleSafely } from './billingPostCommit.js'
import { logger } from '../../utils/logger.js'
import { clearOnboardingTenant } from '../../user/identity/authRepository.js'

const BILLING_URL = '/billing'

const COPY = {
  [BILLING_NOTIFICATION_TYPES.ACTIVATED]: {
    title: 'Subscription active',
    body: 'Your first payment went through — your GigBuddy subscription is active.',
  },
  [BILLING_NOTIFICATION_TYPES.RENEWED]: {
    title: 'Subscription renewed',
    body: 'Your GigBuddy subscription has renewed.',
  },
  [BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED]: {
    title: 'Payment failed',
    body: "We couldn't process your subscription payment. Please check your payment details.",
  },
  [BILLING_NOTIFICATION_TYPES.PLAN_CHANGED]: {
    title: 'Plan changed',
    body: 'Your GigBuddy plan change is now active.',
  },
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10)
}

// The first linked payment is mandate verification for a trial and a full
// conversion charge for direct signup. 'proration' is an on-demand mid-cycle
// difference; everything else comes from the recurring schedule.
function classifyKind(sub, payment, existingPayment) {
  if (existingPayment?.kind) return existingPayment.kind
  if (payment.id === sub.mollie_first_payment_id) {
    return sub.status === 'trialing' ? 'mandate_verification' : 'conversion'
  }
  if (payment.id === sub.pending_payment_id) return 'proration'
  return 'recurring'
}

// What this subscription's own durable state says a charge of this kind may
// cost. Every payment this system asks the provider for is mirrored locally by
// the outbox completion BEFORE it can settle, so its recorded amount is the
// exact expectation; only a schedule-generated recurring charge has no local
// row yet.
//
// The recurring case accepts the period just charged as well as the next one on
// purpose. reconcileNextPeriodPricing can move next_total_cents (a lapsing
// discount) before repairSchedule has recreated the remote schedule, so a charge
// already in flight at the old amount is genuine and must still open its period.
// The job of this check is that a token amount can never buy a period — not to
// pin the price to the cent, which the schedule repair already owns.
//
// An empty list means "nothing to compare against".
function allowedAmountsCents(sub, kind, existingPayment) {
  if (existingPayment) return [existingPayment.amount_cents]
  switch (kind) {
    case 'recurring': return [sub.next_total_cents ?? sub.total_cents, sub.total_cents]
    case 'conversion': return [sub.pending_total_cents ?? sub.total_cents]
    case 'mandate_verification': return [MANDATE_VERIFICATION_CENTS]
    default: return []
  }
}

// A charge counts against the live (current) period when it was created no
// earlier than the current period start — the renewal charge for the ongoing
// cycle, or the paid charge that a chargeback/refund later reverses. An older
// charge is a historical record only.
function isCurrentPeriodCharge(sub, payment) {
  if (!sub.current_period_start || !payment.createdAt) return true
  return new Date(payment.createdAt) >= new Date(sub.current_period_start)
}

async function notify(client, userId, type, dedupeKey, pushes) {
  const { title, body } = COPY[type]
  const { inserted } = await dispatchUserNotification({
    userId, type, title, body, url: BILLING_URL, dedupeKey, client,
  })
  if (inserted) pushes.push({ userId, type, title, body, url: BILLING_URL })
}

// Scheduled downgrades and removals land at the period boundary, which is
// exactly when a renewal charge settles. A removal's purge manifest is copied
// out before the row goes, because the purge runs after the commit.
async function applyBoundaryModuleChanges(client, sub, ctx) {
  for (const module of await listModuleChangesDueAtPeriodEnd(client, sub.id)) {
    if (module.pending_change_kind === 'remove') {
      if (module.pending_purge_manifest) {
        ctx.purges.push({ manifest: module.pending_purge_manifest, audience: module.audience })
      }
      await deleteModule(client, module.id)
    } else {
      await applyModuleChange(client, module.id)
      // The manifest survives the change; the post-commit purge consumes it.
      if (module.pending_purge_manifest) ctx.purgeModuleIds.push(module.id)
    }
  }
}

async function handlePaid(client, sub, payment, kind, ctx) {
  if (kind === 'mandate_verification') {
    // The cent authorized future payments; trial access and dates do not move.
    // The post-commit saga creates the first real charge at trial_ends_at.
    ctx.sagaHints.add('repair_schedule')
    return
  }

  if (kind === 'conversion') {
    // A direct signup has paid its first full combined amount. That payment also
    // established the mandate, so schedule creation is deferred until commit.
    const periodStart = payment.paidAt ?? new Date()
    const periodEnd = ctx.periodEndHint ?? periodEndFrom(periodStart, sub.billing_interval)
    const converted = await applyConversion(client, sub.id, {
      periodStart, periodEnd, paymentId: payment.id,
    })
    if (!converted) return
    // The first paid charge is the authoritative completion point for a paid
    // onboarding. Clear the resume pointer in this transaction so webhook,
    // polling and manual-sync settlement all self-heal a checkout timeout.
    await clearOnboardingTenant(client, sub.user_id)
    // Reprice before the schedule is built: the recurring amount is the NEXT
    // period's price, which a discount window can already have changed.
    ctx.sagaHints.add('reprice')
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.ACTIVATED,
      `billing-activated:${sub.id}`, ctx.pushes)
    return
  }

  if (kind === 'proration') {
    // Activate-first: the customer has paid the difference, so the module
    // change lands now. current_period_end is deliberately NOT touched — they
    // paid only for the remainder of the period they already have.
    const module = await fetchInFlightModuleChange(client, sub.id)
    if (module) await applyModuleChange(client, module.id)
    await applyModuleChangeActivation(client, sub.id)
    ctx.sagaHints.add('reprice')
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PLAN_CHANGED,
      `billing-plan-changed:${sub.id}:${payment.id}`, ctx.pushes)
    return
  }

  // recurring: absolute period from paidAt; end from the provider hint (a
  // subscription-generated charge) or the interval fallback.
  const wasActive = sub.status === 'active'
  const periodStart = payment.paidAt ?? new Date()
  const periodEnd = ctx.periodEndHint ?? periodEndFrom(periodStart, sub.billing_interval)
  const advanced = await advanceSubscriptionPeriod(client, sub.id, periodStart, periodEnd, {
    paymentId: payment.id,
  })
  if (!advanced) return
  // The new period is paid for, so anything scheduled for the boundary is now
  // real — and only now may its purge run.
  await applyBoundaryModuleChanges(client, sub, ctx)
  ctx.sagaHints.add('reprice')
  // Notify only on a genuine renewal (already active), keyed per covered period.
  if (wasActive) {
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.RENEWED,
      `billing-renewed:${sub.id}:${dateKey(periodStart)}`, ctx.pushes)
  } else {
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.ACTIVATED,
      `billing-activated:${sub.id}`, ctx.pushes)
  }
}

async function handleUnpaid(client, sub, payment, kind, status, ctx) {
  const failedTerminal = status === PAYMENT_STATUS.FAILED || status === PAYMENT_STATUS.EXPIRED

  if (failedTerminal && kind === 'proration') {
    // The on-demand difference failed: drop the module change, keep what the
    // customer already had, tell them. Nothing was purged and nothing granted.
    const module = await fetchInFlightModuleChange(client, sub.id)
    if (module?.status === 'pending') await deleteModule(client, module.id)
    else if (module) await clearModulePendingChange(client, module.id)
    await clearPendingChange(client, sub.id)
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
      `billing-payment-failed:${payment.id}`, ctx.pushes)
    return
  }

  if (failedTerminal && kind === 'conversion') {
    // Never converted. The subscription simply never becomes active; the
    // stale-activation sweep cancels it. Nothing to flip here.
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
      `billing-payment-failed:${payment.id}`, ctx.pushes)
    return
  }

  if (failedTerminal && kind === 'mandate_verification') {
    // The free trial continues. The customer can start a fresh verification
    // checkout; no subscription charge was scheduled from this failed attempt.
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
      `billing-payment-failed:${payment.id}`, ctx.pushes)
    return
  }

  // Recurring failure, or a chargeback/refund on any kind: an unpaid current
  // period drops to past_due; an older reversal is recorded only. A canceled
  // subscription is terminal — markSubscriptionPastDue will not revive it,
  // which is what keeps a post-cancellation refund from resurrecting the row.
  if (isCurrentPeriodCharge(sub, payment)) {
    await markSubscriptionPastDue(client, sub.id, new Date())
  }
  await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
    `billing-payment-failed:${payment.id}`, ctx.pushes)
}

// The one ingestion entry point. `periodEndHint` is the provider's authoritative
// next payment timestamp for a schedule-generated recurring charge, fetched by the
// caller BEFORE this transaction (never a remote call inside the txn). Returns
// { pushes, sagaHints, purges, purgeModuleIds } for the caller to execute
// post-commit.
export async function applyPaymentOutcome(subId, payment, { periodEndHint = null } = {}) {
  const ctx = { periodEndHint, pushes: [], sagaHints: new Set(), purges: [], purgeModuleIds: [] }
  const empty = { pushes: [], sagaHints: [], purges: [], purgeModuleIds: [] }
  return withTransaction(async (client) => {
    const sub = await fetchSubscriptionByIdForUpdate(client, subId)
    if (!sub || sub.is_complimentary) abortTransaction(empty)

    const existingPayment = await fetchPaymentByMollieId(client, payment.id)
    // mollie_payment_id is UNIQUE across all subscriptions, so a local row for
    // another subscription means this payment is not ours to act on. Nothing is
    // recorded, so the rightful subscription can still ingest it.
    if (existingPayment && existingPayment.subscription_id !== subId) {
      logger.warn('billing.payment_subscription_mismatch', { subscriptionId: subId })
      return empty
    }

    const kind = classifyKind(sub, payment, existingPayment)

    // Defence in depth behind the ingestion bindings: a paid amount that is not
    // the one this subscription owes can never buy a period. Recorded and
    // logged only — the webhook must still answer 200, and the reconcile poll
    // re-ingests once local state and the charge agree.
    if (payment.status === PAYMENT_STATUS.PAID) {
      const allowed = allowedAmountsCents(sub, kind, existingPayment).filter((c) => c != null)
      if (allowed.length > 0 && !allowed.includes(payment.amount.cents)) {
        logger.warn('billing.payment_amount_mismatch', { subscriptionId: subId, paymentKind: kind })
        return empty
      }
    }

    const row = await upsertPaymentOutcome(client, {
      subscriptionId: subId,
      molliePaymentId: payment.id,
      kind,
      amountCents: payment.amount.cents,
      status: payment.status,
      paidAt: payment.paidAt,
      mollieCreatedAt: payment.createdAt,
      priceSnapshot: kind === 'proration'
        ? sub.pending_price_snapshot
        : (kind === 'recurring' ? (sub.next_price_snapshot ?? sub.price_snapshot) : sub.price_snapshot),
    })
    if (!row) {
      // Inert transition (illegal/regressive/duplicate) — commit (no effect).
      return empty
    }

    // Capture the mandate id the first time the conversion payment reveals it.
    if ((kind === 'conversion' || kind === 'mandate_verification')
      && payment.mandateId && !sub.mollie_mandate_id) {
      await setMandateLinkage(client, subId, { mandateId: payment.mandateId })
      await setScheduleStale(client, subId, true)
    }

    if (row.status === PAYMENT_STATUS.PAID) {
      await handlePaid(client, sub, payment, kind, ctx)
    } else {
      await handleUnpaid(client, sub, payment, kind, row.status, ctx)
    }

    return {
      pushes: ctx.pushes,
      sagaHints: [...ctx.sagaHints],
      purges: ctx.purges,
      purgeModuleIds: ctx.purgeModuleIds,
    }
  })
}

// Post-commit side effects: best-effort push for freshly-inserted notifications,
// the purges whose target plan has just become real, then any deferred remote
// saga repair.
async function runPostCommit(subId, { pushes, sagaHints, purges, purgeModuleIds }) {
  for (const p of pushes) pushUserNotification(p.userId, p)

  for (const moduleId of purgeModuleIds) {
    await executeModulePurge(pool, { moduleId }).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: subId }))
  }
  for (const removed of purges) {
    await executeModulePurge(pool, { subscriptionId: subId, ...removed }).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: subId }))
  }

  // A reprice always implies a schedule repair — the amount it computes is what
  // the schedule must charge — so the combined helper covers both hints.
  if (sagaHints.includes('reprice')) {
    await repriceAndRepairSchedule(subId)
  } else if (sagaHints.includes('repair_schedule')) {
    await repairScheduleSafely(subId)
  }
}

// Ingest a provider payment by (local subscription id, provider payment id).
// Used by both the webhook and the reconcile poll. Status is ALWAYS re-fetched
// authoritatively from the provider — the caller-supplied id is only a routing
// hint, and on the public webhook it is an unauthenticated query parameter.
//
// Two independent bindings must agree with that hint before any effect fires,
// and BOTH fail closed:
//   1. the payment's own metadata, which every payment this system creates
//      carries as billingMetadata(subscriptionId, purpose),
//   2. the subscription owner's provider customer — a null on either side is a
//      mismatch, not a pass, because a trialing subscription is exactly the
//      population an "any null is fine" check would leave undefended.
// The schedule's next-payment timestamp is fetched here, before the ingestion
// transaction, so no remote call happens inside the txn.
export async function ingestProviderPayment(subId, providerPaymentId) {
  const provider = getPaymentProvider()
  const sub = await fetchSubscriptionById(pool, subId)
  const empty = { pushes: [], sagaHints: [], purges: [], purgeModuleIds: [] }
  if (!sub) return empty

  const payment = await provider.getPayment({ paymentId: providerPaymentId })

  const claimed = payment.metadata?.subscriptionId
  if (claimed != null && String(claimed) !== String(subId)) {
    logger.warn('billing.webhook_subscription_mismatch', { subscriptionId: subId })
    return empty
  }

  const customerId = await fetchUserMollieCustomerId(pool, sub.user_id)
  if (payment.customerId !== customerId) {
    logger.warn('billing.webhook_customer_mismatch', { subscriptionId: subId })
    return empty
  }

  let periodEndHint = null
  if (payment.scheduleId && customerId) {
    const remote = await provider
      .getSchedule({ customerId, scheduleId: payment.scheduleId })
      .catch(() => null)
    periodEndHint = remote?.nextPaymentAt ?? null
  }

  const outcome = await applyPaymentOutcome(subId, payment, { periodEndHint })
  await runPostCommit(subId, outcome)
  return outcome
}
