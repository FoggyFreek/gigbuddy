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
  subscriptionHasNonterminalPayment,
  markTrialReminderSent,
  cancelSubscriptionNow,
} from '../repositories/subscriptionRepository.js'
import { listStaleNonterminalPayments } from '../repositories/subscriptionPaymentRepository.js'
import { listStalePendingOperations } from '../repositories/billingOperationRepository.js'
import { ingestProviderPayment } from '../services/paymentIngestionService.js'
import { repairSchedule, cancelRemoteSubscription } from '../services/billingSaga.js'
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

// Task 1: abandon stale signups. A pending_mandate whose mandate never confirmed
// within 24h is a dropped checkout; a pending_activation whose first real charge
// never settled within 7d (and has nothing in flight) has lapsed.
export async function reconcileStaleSignups(db = pool) {
  for (const sub of await listStalePendingMandate(db, PENDING_MANDATE_STALE_MS)) {
    await cancelSubscriptionNow(db, sub.id, 'trial_abandoned')
    logger.info('billing.signup_abandoned', { subscriptionId: sub.id })
  }
  for (const sub of await listStalePendingActivation(db, PENDING_ACTIVATION_STALE_MS)) {
    if (await subscriptionHasNonterminalPayment(db, sub.id)) continue // SEPA still settling
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

// Task 6: finalize cancel-at-period-end once the paid period has passed.
// (A pending purge manifest — the bronze-downgrade path — is executed here in
// phase 6; no manifests exist yet.)
export async function reconcileCancelAtPeriodEnd(db = pool) {
  for (const sub of await listCancelAtPeriodEndDue(db)) {
    const reason = sub.cancel_reason ?? 'user_requested'
    await cancelSubscriptionNow(db, sub.id, reason)
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
  ['past_due', reconcilePastDue],
  ['cancel_at_period_end', reconcileCancelAtPeriodEnd],
  ['trial_reminders', reconcileTrialReminders],
  ['orphan_operations', reconcileOrphanOperations],
  ['expired_complimentary', reconcileExpiredComplimentary],
]
