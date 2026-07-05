// User-facing billing operations: subscribe, cancel, resume, change plan, and
// the read model for the /billing page. Downgrade lands in a later phase (501).
//
// Design rules (see the rev-5 plan + memory):
// - Local state first: the subscription row is inserted and committed BEFORE any
//   remote provider call, so a failed/abandoned signup is just a stale
//   pending_mandate row the scheduler cleans up.
// - No access before an authoritatively-paid payment: subscribe/upgrade leave
//   entitlements unchanged until ingestion sees a paid charge.
// - Every remote mutation goes through the saga layer (billing_operations
//   outbox); this service never calls the provider SDK directly.
// - Expected failures return { error: { status, body } }; success returns a
//   named payload.
import pool from '../db/index.js'
import { fetchPlan } from '../repositories/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchLiveSubscriptionForUpdate,
  insertSubscription,
  hasUsedTrial,
  setPendingChange,
  setPendingPaymentId,
  clearPendingChange,
  switchPlanTrial,
  setCancelAtPeriodEnd,
  clearCancelAtPeriodEnd,
  cancelSubscriptionNow,
  setScheduleStale,
} from '../repositories/subscriptionRepository.js'
import {
  upsertPaymentOutcome,
  fetchPaymentByMollieId,
  listNonterminalPaymentsForSubscription,
} from '../repositories/subscriptionPaymentRepository.js'
import { ingestProviderPayment } from './paymentIngestionService.js'
import { countActiveOwnedTenants } from '../repositories/limitRepository.js'
import {
  createMandateCheckout,
  chargePlanChange,
  cancelRemoteSubscription,
  repairSchedule,
} from './billingSaga.js'
import { priceForInterval, trialEndFrom, MANDATE_AMOUNT_CENTS } from './billingShared.js'
import {
  isPlatformBillingConfigured,
  PaymentProviderError,
  PAYMENT_STATUS,
} from '../billing/paymentProvider/index.js'
import { FEATURE_KEYS, LIMIT_KEYS } from '../auth/entitlements.js'
import { parsePlanSelection } from '../validators/billingValidators.js'
import { logger } from '../utils/logger.js'

function badRequest(error, code) {
  return { error: { status: 400, body: { error, ...(code ? { code } : {}) } } }
}
function conflict(error, code) {
  return { error: { status: 409, body: { error, ...(code ? { code } : {}) } } }
}
const NOT_CONFIGURED = { error: { status: 503, body: { error: 'Billing is not configured', code: 'billing_not_configured' } } }
const PROVIDER_ERROR = { error: { status: 502, body: { error: 'Payment provider error', code: 'provider_error' } } }
const COMPLIMENTARY = { error: { status: 409, body: { error: 'This subscription is managed by an administrator', code: 'complimentary_managed_by_admin' } } }

// A target with any feature removed or any numeric limit reduced (null =
// unlimited = largest) relative to the current plan is a downgrade.
function isDowngrade(currentEnt, targetEnt) {
  for (const f of FEATURE_KEYS) {
    if (currentEnt.features[f] && !targetEnt.features[f]) return true
  }
  for (const l of LIMIT_KEYS) {
    const cur = currentEnt.limits[l]
    const tgt = targetEnt.limits[l]
    if (cur === null && tgt !== null) return true
    if (cur !== null && tgt !== null && tgt < cur) return true
  }
  return false
}

// ---- subscribe ----

export async function subscribe(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parsePlanSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { planId, interval } = parsed

  const plan = await fetchPlan(db, planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) return badRequest('The free plan needs no subscription')
  const price = priceForInterval(plan, interval)
  if (price === null) return badRequest('This plan is not available for the chosen interval', 'plan_not_priced')
  if (price <= 0) return badRequest('This plan is not available for the chosen interval', 'plan_not_priced')

  if (await fetchLiveSubscriptionForUser(db, user.id)) {
    return conflict('You already have an active subscription', 'already_subscribed')
  }

  const trialEligible = !(await hasUsedTrial(db, user.id))
  let sub
  try {
    sub = await insertSubscription(db, {
      user_id: user.id,
      plan_id: planId,
      status: 'pending_mandate',
      billing_interval: interval,
      price_cents: price,
      trial_ends_at: trialEligible ? trialEndFrom() : null,
    })
  } catch (err) {
    if (err.code === '23505') return conflict('You already have an active subscription', 'already_subscribed')
    throw err
  }

  // Remote, local-state-already-committed. A failure here leaves a
  // pending_mandate row for the scheduler to abandon after the grace window.
  try {
    const { paymentId, checkoutUrl } = await createMandateCheckout(db, sub, {
      email: user.email, name: user.name, amountCents: MANDATE_AMOUNT_CENTS,
    })
    await upsertPaymentOutcome(db, {
      subscriptionId: sub.id,
      molliePaymentId: paymentId,
      kind: 'mandate_verification',
      amountCents: MANDATE_AMOUNT_CENTS,
      status: PAYMENT_STATUS.OPEN,
      mollieCreatedAt: new Date(),
    })
    return { checkoutUrl, subscriptionId: sub.id, trial: trialEligible }
  } catch (err) {
    if (err instanceof PaymentProviderError) return PROVIDER_ERROR
    throw err
  }
}

// ---- cancel ----

export async function cancelSubscription(db, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) { await client.query('ROLLBACK'); return { error: { status: 404, body: { error: 'No subscription' } } } }
    if (sub.is_complimentary) { await client.query('ROLLBACK'); return COMPLIMENTARY }
    if (sub.cancel_at_period_end) { await client.query('COMMIT'); return { alreadyScheduled: true } }

    // A pending upgrade/interval change mid-flight must not be stranded (a
    // settling charge would take money for a subscription about to cancel).
    if (sub.pending_plan_id && sub.pending_change_kind !== 'downgrade') {
      const inFlight = sub.mollie_schedule_stale || (await isPendingChargeNonterminal(client, sub))
      if (inFlight) { await client.query('ROLLBACK'); return conflict('A plan change is in progress', 'plan_change_in_progress') }
    }
    // A pending downgrade is safely clearable (its replacement hasn't charged).
    if (sub.pending_plan_id) await clearPendingChange(client, sub.id)

    const hasPaidPeriod = sub.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) > new Date()
    if (hasPaidPeriod) {
      await setCancelAtPeriodEnd(client, sub.id, 'user_requested')
    } else {
      // Trial / not-yet-activated / past_due: nothing paid to honor — cancel now.
      await cancelSubscriptionNow(client, sub.id, 'user_requested')
    }
    await client.query('COMMIT')

    // Remote: stop the provider schedule (idempotent). Outside the txn.
    await cancelRemoteSubscription(pool, sub).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
    return { canceled: true, atPeriodEnd: hasPaidPeriod }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function isPendingChargeNonterminal(executor, sub) {
  if (!sub.pending_payment_id) return false
  const payment = await fetchPaymentByMollieId(executor, sub.pending_payment_id)
  return Boolean(payment && (payment.status === PAYMENT_STATUS.OPEN || payment.status === PAYMENT_STATUS.PENDING))
}

// ---- resume ----

export async function resumeSubscription(db, userId) {
  const client = await db.connect()
  let subId = null
  try {
    await client.query('BEGIN')
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) { await client.query('ROLLBACK'); return { error: { status: 404, body: { error: 'No subscription' } } } }
    if (sub.is_complimentary) { await client.query('ROLLBACK'); return COMPLIMENTARY }
    if (!sub.cancel_at_period_end) { await client.query('ROLLBACK'); return badRequest('Nothing to resume') }
    if (sub.current_period_end && new Date(sub.current_period_end) <= new Date()) {
      await client.query('ROLLBACK')
      return conflict('The subscription period has already ended', 'already_ended')
    }
    await clearCancelAtPeriodEnd(client, sub.id)
    await setScheduleStale(client, sub.id, true) // recreate the provider schedule
    subId = sub.id
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  await repairSchedule(pool, subId).catch((err) =>
    logger.error('billing.resume_repair_failed', { err, subscriptionId: subId }))
  return { resumed: true }
}

// ---- change plan (upgrade / interval only; downgrade → dedicated endpoint) ----

export async function changePlan(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parsePlanSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { planId, interval } = parsed

  const targetPlan = await fetchPlan(db, planId)
  if (!targetPlan || !targetPlan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (targetPlan.is_fallback) return badRequest('Use downgrade to move to the free plan', 'use_downgrade_endpoint')
  const price = priceForInterval(targetPlan, interval)
  if (price === null || price <= 0) return badRequest('This plan is not available for the chosen interval', 'plan_not_priced')

  const client = await db.connect()
  let charge = null
  try {
    await client.query('BEGIN')
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (!sub) { await client.query('ROLLBACK'); return { error: { status: 404, body: { error: 'No subscription' } } } }
    if (sub.is_complimentary) { await client.query('ROLLBACK'); return COMPLIMENTARY }
    if (!sub.mollie_mandate_id) { await client.query('ROLLBACK'); return conflict('No valid payment mandate', 'no_mandate') }
    if (sub.pending_plan_id) { await client.query('ROLLBACK'); return conflict('A plan change is in progress', 'plan_change_in_progress') }
    if (sub.cancel_at_period_end) { await client.query('ROLLBACK'); return conflict('Resume the subscription before changing plans', 'plan_change_in_progress') }

    const sameInterval = interval === sub.billing_interval
    if (targetPlan.id === sub.plan_id && sameInterval) { await client.query('ROLLBACK'); return badRequest('Already on this plan') }

    const kind = targetPlan.id === sub.plan_id
      ? 'interval'
      : (isDowngrade(sub.plan_entitlements, targetPlan.entitlements) ? 'downgrade' : 'upgrade')
    if (kind === 'downgrade') { await client.query('ROLLBACK'); return badRequest('Use the downgrade endpoint for a lower tier', 'use_downgrade_endpoint') }

    if (sub.status === 'trialing') {
      // Trial is free: switch immediately, recreate the schedule at the new
      // amount before the trial ends (repair stages only, no charge).
      await switchPlanTrial(client, sub.id, { planId, interval, priceCents: price })
      await client.query('COMMIT')
      await repairSchedule(pool, sub.id).catch((err) =>
        logger.error('billing.trial_change_repair_failed', { err, subscriptionId: sub.id }))
      return { changed: true, trial: true }
    }

    // Active: set pending state (durable) BEFORE the on-demand charge so the
    // paid webhook can classify the charge and activate-first. Entitlements stay
    // unchanged until that charge is paid.
    await setPendingChange(client, sub.id, { planId, kind, interval, priceCents: price })
    charge = { sub, planSlug: targetPlan.slug, planId, interval, price }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  // Remote on-demand charge, outside the txn.
  try {
    const { paymentId } = await chargePlanChange(pool, charge.sub, {
      planId: charge.planId, planSlug: charge.planSlug, interval: charge.interval, priceCents: charge.price,
    })
    await setPendingPaymentId(pool, charge.sub.id, paymentId)
    await upsertPaymentOutcome(pool, {
      subscriptionId: charge.sub.id,
      molliePaymentId: paymentId,
      kind: 'plan_change',
      amountCents: charge.price,
      status: PAYMENT_STATUS.OPEN,
      mollieCreatedAt: new Date(),
    })
    return { changed: true, pending: true }
  } catch (err) {
    // The charge could not be created — roll the pending change back.
    await clearPendingChange(pool, charge.sub.id).catch(() => {})
    if (err instanceof PaymentProviderError) return PROVIDER_ERROR
    throw err
  }
}

// ---- downgrade (phase 6) ----

export async function downgrade() {
  return { error: { status: 501, body: { error: 'Downgrade is not yet available', code: 'not_implemented' } } }
}

// ---- read model ----

export function serializeSubscription(sub) {
  if (!sub) return null
  return {
    id: sub.id,
    planId: sub.plan_id,
    planSlug: sub.plan_slug,
    status: sub.status,
    billingInterval: sub.billing_interval,
    priceCents: sub.price_cents,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodEnd: sub.current_period_end,
    trialEndsAt: sub.trial_ends_at,
    isComplimentary: sub.is_complimentary,
    complimentaryExpiresAt: sub.complimentary_expires_at,
    pendingChange: sub.pending_plan_id
      ? { planId: sub.pending_plan_id, kind: sub.pending_change_kind, interval: sub.pending_billing_interval, priceCents: sub.pending_price_cents }
      : null,
    scheduleStale: sub.mollie_schedule_stale,
    repairNeeded: sub.billing_repair_needed,
  }
}

export async function getBillingState(db, userId) {
  const [sub, ownedTenantCount] = await Promise.all([
    fetchLiveSubscriptionForUser(db, userId),
    countActiveOwnedTenants(db, userId),
  ])
  return { subscription: serializeSubscription(sub), ownedTenantCount }
}

// Manual reconcile for the current user's subscription — the dev "sync" button
// when webhooks are disabled. Re-ingests every nonterminal payment and repairs
// a stale schedule. Safe to call anytime (ingestion is idempotent).
export async function syncOwnSubscription(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  if (!sub) return { subscription: null }
  const payments = await listNonterminalPaymentsForSubscription(db, sub.id)
  for (const p of payments) {
    await ingestProviderPayment(sub.id, p.mollie_payment_id).catch((err) =>
      logger.error('billing.sync_ingest_failed', { err, subscriptionId: sub.id }))
  }
  if (sub.mollie_schedule_stale) {
    await repairSchedule(pool, sub.id).catch((err) =>
      logger.error('billing.sync_repair_failed', { err, subscriptionId: sub.id }))
  }
  const refreshed = await fetchLiveSubscriptionForUser(db, userId)
  return { subscription: serializeSubscription(refreshed) }
}
