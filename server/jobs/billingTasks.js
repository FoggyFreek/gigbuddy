// The billing reconciliation tasks, called from runReconciliationTick under the
// single-instance advisory lock. Each task is independent and defensive; the
// tick wraps every call in its own try/catch so one failure never starves the
// rest.
//
// The entitlement resolver enforces all access time-bounds itself, so these
// tasks are REPAIR-ONLY: they flip durable status, settle in-flight charges,
// finish sagas, and clean up — access never depends on them running.
import pool from '../db/index.js'
import {
  listStalePendingMandate,
  listStalePendingActivation,
  listScheduleStale,
  listCancelAtPeriodEndDue,
  listPastDueExpired,
  listExpiredComplimentary,
  listTrialReminderDue,
  listDowngradeSchedulePending,
  listPendingActivationDowngrades,
  listPendingDowngradesDue,
  listPendingPurges,
  subscriptionHasNonterminalPayment,
  markTrialReminderSent,
  cancelSubscriptionNow,
  clearPendingChange,
  flipToPendingActivation,
  fetchUserMollieCustomerId,
} from '../repositories/subscriptionRepository.js'
import { listStaleNonterminalPayments } from '../repositories/subscriptionPaymentRepository.js'
import { listStalePendingOperations } from '../repositories/billingOperationRepository.js'
import { ingestProviderPayment } from '../services/paymentIngestionService.js'
import {
  repairSchedule,
  cancelRemoteSubscription,
  scheduleDowngradeReplacement,
} from '../services/billingSaga.js'
import { executeDowngradePurge } from '../services/entitlementPurgeService.js'
import { getPaymentProvider, SUBSCRIPTION_STATUS } from '../billing/paymentProvider/index.js'
import { dispatchUserNotification, pushUserNotification } from '../services/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../services/notificationTypes.js'
import { logger } from '../utils/logger.js'

const DAY_MS = 24 * 60 * 60 * 1000
const PENDING_MANDATE_STALE_MS = DAY_MS
const PENDING_ACTIVATION_STALE_MS = 7 * DAY_MS
const NONTERMINAL_POLL_MS = 60 * 60 * 1000
const PAST_DUE_GRACE_MS = 14 * DAY_MS
const TRIAL_REMINDER_WINDOW_MS = 2 * DAY_MS
const ORPHAN_OP_STALE_MS = 10 * 60 * 1000

async function notifyUser(userId, type, title, body, dedupeKey) {
  const { inserted } = await dispatchUserNotification({ userId, type, title, body, url: '/billing', dedupeKey })
  if (inserted) pushUserNotification(userId, { type, title, body, url: '/billing' })
}

// Terminal downgrade failure: the replacement subscription will never pay
// (retry window exhausted or the provider reports it canceled/completed).
// Cancels the replacement remotely, clears EVERY piece of pending downgrade
// state — pending change, schedule marker, superseded id, manifest, snapshot
// — and terminally cancels the local row. NOTHING is purged: the customer
// never got the lower tier, so their data stays (fallback-locked, PBI 11.9).
export async function finalizeFailedDowngrade(db, sub) {
  await cancelRemoteSubscription(db, sub).catch((err) =>
    logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
  if (sub.superseded_mollie_subscription_id
      && sub.superseded_mollie_subscription_id !== sub.mollie_subscription_id) {
    await cancelRemoteSubscription(db, sub, sub.superseded_mollie_subscription_id).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
  }
  await clearPendingChange(db, sub.id)
  await cancelSubscriptionNow(db, sub.id, 'payment_failed')
  await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
    'Subscription canceled',
    'Your downgrade could not be completed because the payment failed. Your subscription has ended; your data is kept.',
    `billing-canceled:${sub.id}`)
  logger.info('billing.downgrade_failed_finalized', { subscriptionId: sub.id })
}

// Task 1: abandon stale signups. A pending_mandate whose mandate never confirmed
// within 24h is a dropped checkout; a pending_activation whose first real charge
// never settled within 7d (aged from the flip into pending_activation, and with
// nothing in flight — Mollie may still be retrying) has lapsed. A lapsed row
// carrying a pending downgrade finalizes via finalizeFailedDowngrade: all
// downgrade state cleared, nothing purged.
export async function reconcileStaleSignups(db = pool) {
  for (const sub of await listStalePendingMandate(db, PENDING_MANDATE_STALE_MS)) {
    await cancelSubscriptionNow(db, sub.id, 'trial_abandoned')
    logger.info('billing.signup_abandoned', { subscriptionId: sub.id })
  }
  for (const sub of await listStalePendingActivation(db, PENDING_ACTIVATION_STALE_MS)) {
    if (await subscriptionHasNonterminalPayment(db, sub.id)) continue // SEPA still settling / Mollie retrying
    if (sub.pending_change_kind === 'downgrade') {
      await finalizeFailedDowngrade(db, sub)
      continue
    }
    await cancelSubscriptionNow(db, sub.id, 'payment_failed')
    await cancelRemoteSubscription(db, sub).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
    logger.info('billing.activation_lapsed', { subscriptionId: sub.id })
  }
}

// Task 2: poll nonterminal payments (lost webhooks, SEPA settlement, in-flight
// plan-change / activation charges) through the same ingestion funnel.
export async function reconcileNonterminalPayments(db = pool) {
  for (const payment of await listStaleNonterminalPayments(db, NONTERMINAL_POLL_MS)) {
    await ingestProviderPayment(payment.subscription_id, payment.mollie_payment_id).catch((err) =>
      logger.error('billing.reconcile_ingest_failed', { err, subscriptionId: payment.subscription_id }))
  }
}

// Task 3 (+ trial-ended schedule assurance / task 4): resume unfinished remote
// schedule repair. repairSchedule flags billing_repair_needed on a terminal
// failure (resolver still locks at period end — bounded and visible).
export async function reconcileScheduleRepairs(db = pool) {
  for (const sub of await listScheduleStale(db)) {
    await repairSchedule(db, sub.id).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: sub.id }))
  }
}

// Downgrade-schedule saga resume: rows whose durable cancel-old/create-
// replacement marker is still set (the inline attempt failed or crashed), plus
// the terminal poll — a replacement subscription the provider reports
// canceled/completed while we wait in pending_activation will never pay, so
// the downgrade fails WITHOUT purging.
export async function reconcileDowngradeSchedules(db = pool) {
  for (const sub of await listDowngradeSchedulePending(db)) {
    await scheduleDowngradeReplacement(db, sub.id).catch((err) =>
      logger.error('billing.downgrade_schedule_failed', { err, subscriptionId: sub.id }))
  }
  const provider = getPaymentProvider()
  for (const sub of await listPendingActivationDowngrades(db)) {
    if (await subscriptionHasNonterminalPayment(db, sub.id)) continue // a charge is still settling
    try {
      const customerId = await fetchUserMollieCustomerId(db, sub.user_id)
      if (!customerId) continue
      const remote = await provider.getSubscription({ customerId, subscriptionId: sub.mollie_subscription_id })
      if (remote.status === SUBSCRIPTION_STATUS.CANCELED || remote.status === SUBSCRIPTION_STATUS.COMPLETED) {
        await finalizeFailedDowngrade(db, sub)
      }
    } catch (err) {
      logger.warn('billing.downgrade_replacement_poll_failed', { err, subscriptionId: sub.id })
    }
  }
}

// Task 7: a pending paid downgrade whose paid period has ended flips to
// pending_activation (stamping pending_activation_at). Access fallback-locks
// via the resolver; NOTHING is purged until the replacement's first charge is
// authoritatively paid.
export async function reconcilePendingDowngrades(db = pool) {
  for (const sub of await listPendingDowngradesDue(db)) {
    const flipped = await flipToPendingActivation(db, sub.id)
    if (!flipped) continue
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.DOWNGRADE_SCHEDULED,
      'Downgrade pending payment',
      'Your billing period has ended. The downgraded plan activates as soon as its first payment is confirmed.',
      `billing-downgrade-pending:${sub.id}`)
    logger.info('billing.downgrade_period_ended', { subscriptionId: sub.id })
  }
}

// Purge safety net: manifests whose downgrade already took effect but whose
// inline purge never ran (crash between the state change and the purge). The
// per-subscription session lock inside executeDowngradePurge prevents any
// overlap with an inline run.
export async function reconcilePendingPurges(db = pool) {
  for (const sub of await listPendingPurges(db)) {
    await executeDowngradePurge(db, sub.id).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: sub.id }))
  }
}

// Task 5: force-cancel subscriptions stuck past_due beyond the retry grace
// (Mollie has exhausted its retries) on both sides.
export async function reconcilePastDue(db = pool) {
  for (const sub of await listPastDueExpired(db, PAST_DUE_GRACE_MS)) {
    await cancelSubscriptionNow(db, sub.id, 'payment_failed')
    await cancelRemoteSubscription(db, sub).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
      'Subscription canceled', 'Your subscription was canceled after repeated failed payments.',
      `billing-canceled:${sub.id}`)
    logger.info('billing.past_due_canceled', { subscriptionId: sub.id })
  }
}

// Task 6: finalize cancel-at-period-end once the paid period has passed. A
// pending purge manifest (the free-fallback downgrade path) executes here —
// the moment the fallback plan becomes the real plan.
export async function reconcileCancelAtPeriodEnd(db = pool) {
  for (const sub of await listCancelAtPeriodEndDue(db)) {
    const reason = sub.cancel_reason ?? 'user_requested'
    await cancelSubscriptionNow(db, sub.id, reason)
    if (sub.pending_purge_manifest) {
      await executeDowngradePurge(db, sub.id).catch((err) =>
        logger.error('billing.purge_failed', { err, subscriptionId: sub.id }))
    }
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
      'Subscription ended', 'Your subscription has ended.',
      `billing-canceled:${sub.id}`)
    logger.info('billing.cancel_finalized', { subscriptionId: sub.id })
  }
}

// Task 8: trial-ending reminder at T-2d, stamped so it fires once.
export async function reconcileTrialReminders(db = pool) {
  for (const sub of await listTrialReminderDue(db, TRIAL_REMINDER_WINDOW_MS)) {
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.TRIAL_ENDING,
      'Trial ending soon', 'Your GigBuddy trial ends in 2 days. Your first payment follows automatically.',
      `billing-trial-ending:${sub.id}`)
    await markTrialReminderSent(db, sub.id)
  }
}

// Task 9: surface billing_operations stuck 'pending' past the grace window (a
// crash around a remote call). State-based tasks (1/2/3) drive the owning saga
// forward on its idempotency key; this alert makes lingering orphans visible.
export async function reconcileOrphanOperations(db = pool) {
  const orphans = await listStalePendingOperations(db, ORPHAN_OP_STALE_MS)
  for (const op of orphans) {
    logger.warn('billing.operation_orphaned', { subscriptionId: op.subscription_id, opType: op.op_type })
  }
}

// Task 11: revoke expired complimentary subscriptions.
export async function reconcileExpiredComplimentary(db = pool) {
  for (const sub of await listExpiredComplimentary(db)) {
    await cancelSubscriptionNow(db, sub.id, 'admin_revoked')
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
      'Complimentary access ended', 'Your complimentary access has expired.',
      `billing-canceled:${sub.id}`)
    logger.info('billing.complimentary_expired', { subscriptionId: sub.id })
  }
}

// Trial expiry (plan task 4) is intentionally NOT a separate task: a trial's
// first post-trial charge is generated by the provider subscription and flows
// through payment ingestion (webhook + task 2 poll), which activates on paid and
// drops to past_due on a failed conversion — exactly the "activate/past_due"
// outcome. Access during and after the trial is resolver-bounded (trial + 2d)
// regardless of this job, so no additional durable-status flip is needed here.

// All billing tasks in order, each isolated. Called by runReconciliationTick.
export const BILLING_TASKS = [
  ['stale_signups', reconcileStaleSignups],
  ['nonterminal_payments', reconcileNonterminalPayments],
  ['schedule_repairs', reconcileScheduleRepairs],
  ['downgrade_schedules', reconcileDowngradeSchedules],
  ['pending_downgrades', reconcilePendingDowngrades],
  ['past_due', reconcilePastDue],
  ['cancel_at_period_end', reconcileCancelAtPeriodEnd],
  ['pending_purges', reconcilePendingPurges],
  ['trial_reminders', reconcileTrialReminders],
  ['orphan_operations', reconcileOrphanOperations],
  ['expired_complimentary', reconcileExpiredComplimentary],
]
