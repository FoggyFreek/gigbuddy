// The billing reconciliation tasks, called from runReconciliationTick under the
// single-instance advisory lock. Each task is independent and defensive; the
// tick wraps every call in its own try/catch so one failure never starves the
// rest.
//
// The entitlement resolver enforces all access time-bounds itself, so these
// tasks are REPAIR-ONLY: they flip durable status, settle in-flight charges,
// finish sagas, and clean up — access never depends on them running. The one
// thing here that is not repair is the renewal notice, which is a message
// rather than a state change.
import pool from '../../../db/index.js'
import {
  listStalePendingActivation,
  listExpiredTrials,
  listScheduleStale,
  listCancelAtPeriodEndDue,
  listPastDueExpired,
  listExpiredComplimentary,
  listTrialReminderDue,
  listRenewalNoticeDue,
  listRepriceCandidates,
  subscriptionHasNonterminalPayment,
  markTrialReminderSent,
  cancelSubscriptionNow,
} from '../subscriptionRepository.js'
import {
  listModules,
  listModulesWithPendingPurge,
} from '../subscriptionModuleRepository.js'
import { listStaleNonterminalPayments } from '../subscriptionPaymentRepository.js'
import { listUnreplayableOperations } from '../billingOperationRepository.js'
import { listPendingRefunds } from '../subscriptionRefundRepository.js'
import { recoverBillingOperations } from '../billingOperationService.js'
import { resumePendingRefund } from '../subscriptionRefundService.js'
import { ingestProviderPayment } from '../paymentIngestionService.js'
import { repairSchedule, cancelRemoteSubscription } from '../billingSaga.js'
import { executeModulePurge } from '../entitlementPurgeService.js'
import { repriceSubscription } from '../subscriptionPricingService.js'
import { dispatchUserNotification, pushUserNotification } from '../../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../../domain/notificationTypes.js'
import { logger } from '../../../utils/logger.js'

const DAY_MS = 24 * 60 * 60 * 1000
const PENDING_ACTIVATION_STALE_MS = 7 * DAY_MS
const NONTERMINAL_POLL_MS = 60 * 60 * 1000
const PAST_DUE_GRACE_MS = 14 * DAY_MS
// The trial has already been resolver-locked for two days by the time this
// fires; the flip is bookkeeping, and the canceled row is what keeps the
// once-per-user trial spent.
const TRIAL_EXPIRY_GRACE_MS = 2 * DAY_MS
const TRIAL_REMINDER_WINDOW_MS = 2 * DAY_MS
const RENEWAL_NOTICE_7D_MS = 7 * DAY_MS
const RENEWAL_NOTICE_1D_MS = 1 * DAY_MS
const ORPHAN_OP_STALE_MS = 10 * 60 * 1000
const REFUND_RESUME_STALE_MS = 10 * 60 * 1000

async function notifyUser(userId, type, title, body, dedupeKey) {
  const { inserted } = await dispatchUserNotification({ userId, type, title, body, url: '/billing', dedupeKey })
  if (inserted) pushUserNotification(userId, { type, title, body, url: '/billing' })
}

// Task 1: abandon stale signups. A pending_activation whose first charge never
// settled within 7d (aged from the flip, and with nothing in flight — Mollie
// may still be retrying) has lapsed.
export async function reconcileStaleSignups(db = pool) {
  for (const sub of await listStalePendingActivation(db, PENDING_ACTIVATION_STALE_MS)) {
    if (await subscriptionHasNonterminalPayment(db, sub.id)) continue // SEPA still settling
    await cancelSubscriptionNow(db, sub.id, 'payment_failed')
    await cancelRemoteSubscription(db, sub).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
    logger.info('billing.activation_lapsed', { subscriptionId: sub.id })
  }
}

// Task 2: a trial that ran out without payment authorization. Trials with a
// verified mandate or an in-flight verification/first charge remain recoverable.
export async function reconcileExpiredTrials(db = pool) {
  for (const sub of await listExpiredTrials(db, TRIAL_EXPIRY_GRACE_MS)) {
    await cancelSubscriptionNow(db, sub.id, 'trial_abandoned')
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
      'Trial ended',
      'Your GigBuddy trial has ended. Your data is kept — subscribe any time to get your features back.',
      `billing-canceled:${sub.id}`)
    logger.info('billing.trial_expired', { subscriptionId: sub.id })
  }
}

// Task 3: poll nonterminal payments (lost webhooks, SEPA settlement, in-flight
// conversion / proration charges) through the same ingestion funnel.
export async function reconcileNonterminalPayments(db = pool) {
  for (const payment of await listStaleNonterminalPayments(db, NONTERMINAL_POLL_MS)) {
    await ingestProviderPayment(payment.subscription_id, payment.mollie_payment_id).catch((err) =>
      logger.error('billing.reconcile_ingest_failed', { err, subscriptionId: payment.subscription_id }))
  }
}

// Task 4: resume unfinished remote schedule repair. repairSchedule flags
// billing_repair_needed on a terminal failure (the resolver still locks at
// period end — bounded and visible).
export async function reconcileScheduleRepairs(db = pool) {
  for (const sub of await listScheduleStale(db)) {
    await repairSchedule(db, sub.id).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: sub.id }))
  }
}

// Task 5: keep the next renewal's price in step with the live discount catalog.
//
// This is what makes a TEMPORARY discount actually temporary. A promo with an
// `effective_to` changes nothing about the subscription when it lapses, so
// without this sweep the provider schedule would keep charging the promotional
// amount for the rest of the customer's life. repriceSubscription only flags
// the schedule stale when the amount really moved, so a quiet tick is cheap.
export async function reconcileNextPeriodPricing(db = pool) {
  for (const sub of await listRepriceCandidates(db)) {
    await repriceSubscription(db, sub.id).catch((err) =>
      logger.error('billing.reprice_failed', { err, subscriptionId: sub.id }))
  }
}

// Purge safety net: manifests whose change already took effect but whose inline
// purge never ran (a crash between the state change and the purge). The
// per-module advisory lock inside executeModulePurge prevents any overlap with
// an inline run.
export async function reconcilePendingPurges(db = pool) {
  for (const module of await listModulesWithPendingPurge(db)) {
    await executeModulePurge(db, { moduleId: module.id }).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: module.subscription_id }))
  }
}

// Task 6: force-cancel subscriptions stuck past_due beyond the retry grace
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

// Task 7: finalize cancel-at-period-end once the paid period has passed. Any
// purge manifest a scheduled downgrade left behind executes here — the moment
// the customer stops paying for the feature.
export async function reconcileCancelAtPeriodEnd(db = pool) {
  for (const sub of await listCancelAtPeriodEndDue(db)) {
    const reason = sub.cancel_reason ?? 'user_requested'
    const modules = await listModules(db, sub.id)
    await cancelSubscriptionNow(db, sub.id, reason)
    for (const module of modules) {
      if (!module.pending_purge_manifest) continue
      await executeModulePurge(db, { moduleId: module.id }).catch((err) =>
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
      'Trial ending soon',
      'Your GigBuddy trial ends in 2 days. Choose a billing cycle to keep your features.',
      `billing-trial-ending:${sub.id}`)
    await markTrialReminderSent(db, sub.id)
  }
}

function euros(cents) {
  return `€${((cents ?? 0) / 100).toFixed(2)}`
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10)
}

// Task 9: advance notice of the combined renewal charge, at T-7 and T-1.
//
// The sweep window is wide (everything renewing inside 7 days) and the tick is
// 15 minutes, so idempotency comes from the notification dedupe key, which
// carries the period end. That also means the copy must be DATE-based, never
// "in 7 days": a subscription that entered the window late would otherwise be
// told a number that is simply wrong.
export async function reconcileRenewalNotices(db = pool) {
  const due = await listRenewalNoticeDue(db, RENEWAL_NOTICE_7D_MS)
  const now = Date.now()
  for (const sub of due) {
    const endsAt = new Date(sub.current_period_end)
    const offset = endsAt.getTime() - now <= RENEWAL_NOTICE_1D_MS ? '1d' : '7d'
    const amount = euros(sub.next_total_cents ?? sub.total_cents)
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.RENEWAL_UPCOMING,
      'Subscription renews soon',
      `Your GigBuddy subscription renews on ${dateKey(endsAt)} for ${amount}.`,
      `billing-renewal-${offset}:${sub.id}:${dateKey(endsAt)}`)
  }
}

// Legacy rows created before commands were persisted cannot be replayed safely;
// keep surfacing those for operator repair.
export async function reconcileOrphanOperations(db = pool) {
  for (const op of await listUnreplayableOperations(db, ORPHAN_OP_STALE_MS)) {
    logger.warn('billing.operation_orphaned', { subscriptionId: op.subscription_id, opType: op.op_type })
  }
}

export async function reconcileBillingOperations(db = pool) {
  await recoverBillingOperations(db)
}

// Task 11: a refund intent committed but never confirmed at the provider. The
// outbox op makes the retry safe — a call that already succeeded is skipped
// rather than refunding twice.
export async function reconcilePendingRefunds(db = pool) {
  for (const refund of await listPendingRefunds(db, REFUND_RESUME_STALE_MS)) {
    await resumePendingRefund(db, refund).catch((err) =>
      logger.error('billing.refund_recovery_failed', {
        err, subscriptionId: refund.subscription_id, refundId: refund.id,
      }))
  }
}

// Task 12: revoke expired complimentary subscriptions.
export async function reconcileExpiredComplimentary(db = pool) {
  for (const sub of await listExpiredComplimentary(db)) {
    await cancelSubscriptionNow(db, sub.id, 'admin_revoked')
    await notifyUser(sub.user_id, BILLING_NOTIFICATION_TYPES.CANCELED,
      'Complimentary access ended', 'Your complimentary access has expired.',
      `billing-canceled:${sub.id}`)
    logger.info('billing.complimentary_expired', { subscriptionId: sub.id })
  }
}

// All billing tasks in order, each isolated. Called by runReconciliationTick.
export const BILLING_TASKS = [
  ['stale_signups', reconcileStaleSignups],
  ['expired_trials', reconcileExpiredTrials],
  ['nonterminal_payments', reconcileNonterminalPayments],
  ['next_period_pricing', reconcileNextPeriodPricing],
  ['schedule_repairs', reconcileScheduleRepairs],
  ['past_due', reconcilePastDue],
  ['cancel_at_period_end', reconcileCancelAtPeriodEnd],
  ['pending_purges', reconcilePendingPurges],
  ['trial_reminders', reconcileTrialReminders],
  ['renewal_notices', reconcileRenewalNotices],
  ['pending_refunds', reconcilePendingRefunds],
  ['billing_operations', reconcileBillingOperations],
  ['orphan_operations', reconcileOrphanOperations],
  ['expired_complimentary', reconcileExpiredComplimentary],
]
