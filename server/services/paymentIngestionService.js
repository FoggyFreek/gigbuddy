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
import pool from '../db/index.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import {
  fetchSubscriptionById,
  fetchSubscriptionByIdForUpdate,
  fetchUserMollieCustomerId,
  setMandateLinkage,
  setStatusGuarded,
  setScheduleStale,
  advanceSubscriptionPeriod,
  markSubscriptionPastDue,
  applyPlanChangeActivation,
  applyDowngradeActivation,
  clearPendingChange,
} from '../repositories/subscriptionRepository.js'
import { executeDowngradePurge } from './entitlementPurgeService.js'
import { upsertPaymentOutcome } from '../repositories/subscriptionPaymentRepository.js'
import { dispatchUserNotification, pushUserNotification } from './notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../domain/notificationTypes.js'
import { periodEndFrom } from './billingShared.js'
import { getPaymentProvider, PaymentProviderError, PAYMENT_STATUS } from '../billing/paymentProvider/index.js'
import { repairSchedule } from './billingSaga.js'
import { logger } from '../utils/logger.js'

const BILLING_URL = '/billing'

const COPY = {
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

function classifyKind(sub, payment) {
  if (payment.id === sub.mollie_first_payment_id) return 'mandate_verification'
  if (payment.id === sub.pending_payment_id) return 'plan_change'
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

async function handlePaid(client, sub, payment, kind, ctx) {
  if (kind === 'mandate_verification') {
    // Mandate established. Trial → trialing now; re-subscribe/trial-used →
    // stay pending_activation (no access) until the first real charge is paid.
    const trial = sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date()
    await setStatusGuarded(client, sub.id, trial ? 'trialing' : 'pending_activation', 'pending_mandate')
    await setScheduleStale(client, sub.id, true)
    ctx.sagaHints.add('repair_schedule')
    return
  }
  if (kind === 'plan_change') {
    // Activate-first stage 0: the customer has paid, switch entitlements now.
    // The purchased interval derives from paidAt + pending_billing_interval —
    // never the old subscription's nextPaymentDate.
    const periodStart = payment.paidAt ?? new Date()
    const periodEnd = periodEndFrom(periodStart, sub.pending_billing_interval)
    await applyPlanChangeActivation(client, sub.id, {
      planId: sub.pending_plan_id,
      interval: sub.pending_billing_interval,
      priceCents: sub.pending_price_cents,
      periodStart,
      periodEnd,
    })
    ctx.sagaHints.add('repair_schedule')
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PLAN_CHANGED,
      `billing-plan-changed:${sub.id}:${payment.id}`, ctx.pushes)
    return
  }
  if (sub.pending_change_kind === 'downgrade') {
    // Provenance guard: ONLY the replacement subscription's charge activates
    // a pending downgrade. The superseded (old-schedule) id is always
    // rejected. The replacement is recognized either by the local repoint
    // (mollie_subscription_id) or — when its first charge beats the repoint —
    // by the downgrade metadata the saga stamped at creation, verified
    // against the provider (ctx.replacementSubscriptionId). Anything else is
    // recorded only — it must not extend current_period_end or delay the
    // fallback lock.
    const fromReplacement = Boolean(payment.subscriptionId)
      && payment.subscriptionId !== sub.superseded_mollie_subscription_id
      && (payment.subscriptionId === sub.mollie_subscription_id
        || payment.subscriptionId === ctx.replacementSubscriptionId)
    if (!fromReplacement) return

    // Activate the downgrade: the customer has paid the lower tier — switch
    // now, keep the manifest for the post-commit purge, leave the schedule
    // alone (the replacement subscription IS the schedule). Passing the
    // charge's provider subscription id repoints a row the saga hasn't
    // repointed yet (and is a no-op after the repoint).
    const periodStart = payment.paidAt ?? new Date()
    const periodEnd = ctx.periodEndHint ?? periodEndFrom(periodStart, sub.pending_billing_interval)
    const activated = await applyDowngradeActivation(client, sub.id, {
      planId: sub.pending_plan_id,
      interval: sub.pending_billing_interval,
      priceCents: sub.pending_price_cents,
      periodStart,
      periodEnd,
      providerSubscriptionId: payment.subscriptionId,
    })
    if (activated) {
      ctx.sagaHints.add('execute_purge')
      await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PLAN_CHANGED,
        `billing-plan-changed:${sub.id}:${payment.id}`, ctx.pushes)
    }
    return
  }
  // recurring: absolute period from paidAt; end from the provider hint (a
  // subscription-generated charge) or the interval fallback.
  const wasActive = sub.status === 'active'
  const periodStart = payment.paidAt ?? new Date()
  const periodEnd = ctx.periodEndHint ?? periodEndFrom(periodStart, sub.billing_interval)
  const advanced = await advanceSubscriptionPeriod(client, sub.id, periodStart, periodEnd)
  // Notify only on a genuine renewal (already active), keyed per covered period.
  if (advanced && wasActive) {
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.RENEWED,
      `billing-renewed:${sub.id}:${dateKey(periodStart)}`, ctx.pushes)
  }
}

async function handleUnpaid(client, sub, payment, kind, status, ctx) {
  const failedTerminal = status === PAYMENT_STATUS.FAILED || status === PAYMENT_STATUS.EXPIRED
  if (failedTerminal && kind === 'plan_change') {
    // The on-demand plan-change charge failed: drop the pending change, keep the
    // old plan, tell the user.
    await clearPendingChange(client, sub.id)
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
      `billing-payment-failed:${payment.id}`, ctx.pushes)
    return
  }
  if (failedTerminal && kind === 'mandate_verification') {
    // Mandate never established — signup abandonment is the scheduler's job
    // (task 1 cancels stale pending_mandate). Nothing to flip here.
    return
  }
  if (failedTerminal && kind === 'recurring' && sub.pending_change_kind === 'downgrade') {
    // A failed replacement charge is NOT terminal for the downgrade: Mollie
    // retries eligible subscription payments (~daily, up to 5 attempts) and a
    // later attempt may pay. Record + notify only — keep the status
    // (pending_activation stays fallback-locked by the resolver) and the
    // manifest; the scheduler decides terminal when the retry window is
    // exhausted or the provider reports the replacement canceled.
    await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
      `billing-payment-failed:${payment.id}`, ctx.pushes)
    return
  }
  // Recurring failure, or a chargeback/refund on any kind: an unpaid current
  // period drops to past_due; an older reversal is recorded only.
  if (isCurrentPeriodCharge(sub, payment)) {
    await markSubscriptionPastDue(client, sub.id, new Date())
  }
  await notify(client, sub.user_id, BILLING_NOTIFICATION_TYPES.PAYMENT_FAILED,
    `billing-payment-failed:${payment.id}`, ctx.pushes)
}

// The one ingestion entry point. `periodEndHint` is the provider's authoritative
// nextPaymentDate for a subscription-generated recurring charge, fetched by the
// caller BEFORE this transaction (never a remote call inside the txn). Returns
// { pushes, sagaHints } for the caller to execute post-commit.
export async function applyPaymentOutcome(subId, payment, { periodEndHint = null, replacementSubscriptionId = null } = {}) {
  const ctx = { periodEndHint, replacementSubscriptionId, pushes: [], sagaHints: new Set() }
  return withTransaction(async (client) => {
    const sub = await fetchSubscriptionByIdForUpdate(client, subId)
    if (!sub || sub.is_complimentary) {
      abortTransaction({ pushes: [], sagaHints: [] })
    }

    const kind = classifyKind(sub, payment)
    const row = await upsertPaymentOutcome(client, {
      subscriptionId: subId,
      molliePaymentId: payment.id,
      kind,
      amountCents: payment.amountCents,
      status: payment.status,
      paidAt: payment.paidAt,
      mollieCreatedAt: payment.createdAt,
    })
    if (!row) {
      // Inert transition (illegal/regressive/duplicate) — commit (no effect).
      return { pushes: [], sagaHints: [] }
    }

    // Capture the mandate id the first time a paid mandate payment reveals it.
    if (kind === 'mandate_verification' && payment.mandateId && !sub.mollie_mandate_id) {
      await setMandateLinkage(client, subId, { mandateId: payment.mandateId })
    }

    if (row.status === PAYMENT_STATUS.PAID) {
      await handlePaid(client, sub, payment, kind, ctx)
    } else {
      await handleUnpaid(client, sub, payment, kind, row.status, ctx)
    }

    return { pushes: ctx.pushes, sagaHints: [...ctx.sagaHints] }
  })
}

// Post-commit side effects: best-effort push for freshly-inserted notifications,
// then any deferred remote saga repair.
async function runPostCommit(subId, { pushes, sagaHints }) {
  for (const p of pushes) pushUserNotification(p.userId, p)
  if (sagaHints.includes('repair_schedule')) {
    await repairSchedule(pool, subId).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: subId }))
  }
  if (sagaHints.includes('execute_purge')) {
    // Downgrade activated: the target plan is real now, run the frozen
    // manifest. Best-effort — the scheduler safety net retries a failed run.
    await executeDowngradePurge(pool, subId).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: subId }))
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
  if (!sub) return { pushes: [], sagaHints: [] }

  const payment = await provider.getPayment(providerPaymentId)
  const customerId = await fetchUserMollieCustomerId(pool, sub.user_id)
  if (customerId && payment.customerId && payment.customerId !== customerId) {
    logger.warn('billing.webhook_customer_mismatch', { subscriptionId: subId })
    return { pushes: [], sagaHints: [] }
  }

  let periodEndHint = null
  let replacementSubscriptionId = null
  if (payment.subscriptionId && customerId) {
    const remote = await provider
      .getSubscription({ customerId, subscriptionId: payment.subscriptionId })
      .catch(() => null)
    periodEndHint = remote?.nextPaymentDate ?? null
    // Downgrade-replacement recognition: the saga stamps the replacement's
    // metadata at creation, so its first charge is attributable even when it
    // beats the local repoint (the provider echoes create-time metadata back).
    if (remote?.metadata?.purpose === 'downgrade'
        && remote.metadata.subscriptionId === String(subId)) {
      replacementSubscriptionId = payment.subscriptionId
    }
    // A PAID charge of unknown provenance during a pending downgrade must not
    // be recorded while the lookup that could attribute it has failed: once
    // recorded, the transition predicate makes every replay of the paid
    // outcome inert, permanently losing the activation. Fail the ingestion
    // instead — nothing is persisted yet, so a later ingest starts fresh.
    if (!remote && payment.status === PAYMENT_STATUS.PAID
        && sub.pending_change_kind === 'downgrade'
        && payment.subscriptionId !== sub.mollie_subscription_id
        && payment.subscriptionId !== sub.superseded_mollie_subscription_id) {
      throw new PaymentProviderError('subscription lookup failed while attributing a pending-downgrade charge', {
        code: 'replacement_lookup_failed', retryable: true,
      })
    }
  }

  const outcome = await applyPaymentOutcome(subId, payment, { periodEndHint, replacementSubscriptionId })
  await runPostCommit(subId, outcome)
  return outcome
}
