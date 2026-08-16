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
import { periodEndFrom } from './billingShared.js'
import { getPaymentProvider, PAYMENT_STATUS } from './paymentProvider/index.js'
import { repairSchedule } from './billingSaga.js'
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
// nextPaymentDate for a subscription-generated recurring charge, fetched by the
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
    const kind = classifyKind(sub, payment, existingPayment)
    const row = await upsertPaymentOutcome(client, {
      subscriptionId: subId,
      molliePaymentId: payment.id,
      kind,
      amountCents: payment.amountCents,
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

  if (sagaHints.includes('reprice')) {
    const { repriceSubscription } = await import('./subscriptionPricingService.js')
    await repriceSubscription(pool, subId).catch((err) =>
      logger.error('billing.reprice_failed', { err, subscriptionId: subId }))
  }
  if (sagaHints.includes('repair_schedule') || sagaHints.includes('reprice')) {
    await repairSchedule(pool, subId).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: subId }))
  }
}

// Ingest a provider payment by (local subscription id, provider payment id).
// Used by both the webhook and the reconcile poll. Status is ALWAYS re-fetched
// authoritatively from the provider — the caller-supplied id is only a routing
// hint. Verifies the payment belongs to the subscription owner's customer
// before applying any effect (a guessed subscription id can't drive someone
// else's payment). The subscription's nextPaymentDate is fetched here, before
// the ingestion transaction, so no remote call happens inside the txn.
export async function ingestProviderPayment(subId, providerPaymentId) {
  const provider = getPaymentProvider()
  const sub = await fetchSubscriptionById(pool, subId)
  const empty = { pushes: [], sagaHints: [], purges: [], purgeModuleIds: [] }
  if (!sub) return empty

  const payment = await provider.getPayment(providerPaymentId)
  const customerId = await fetchUserMollieCustomerId(pool, sub.user_id)
  if (customerId && payment.customerId && payment.customerId !== customerId) {
    logger.warn('billing.webhook_customer_mismatch', { subscriptionId: subId })
    return empty
  }

  let periodEndHint = null
  if (payment.subscriptionId && customerId) {
    const remote = await provider
      .getSubscription({ customerId, subscriptionId: payment.subscriptionId })
      .catch(() => null)
    periodEndHint = remote?.nextPaymentDate ?? null
  }

  const outcome = await applyPaymentOutcome(subId, payment, { periodEndHint })
  await runPostCommit(subId, outcome)
  return outcome
}
