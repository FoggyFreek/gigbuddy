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
  setDowngradeCancel,
  setDowngradePending,
  setPurgeManifest,
} from '../repositories/subscriptionRepository.js'
import {
  upsertPaymentOutcome,
  fetchPaymentByMollieId,
  listNonterminalPaymentsForSubscription,
} from '../repositories/subscriptionPaymentRepository.js'
import { ingestProviderPayment } from './paymentIngestionService.js'
import {
  countActiveOwnedTenants,
  countRosterMembers,
  countApprovedMemberships,
  listOwnedTenants,
  getTenantStorageBytes,
  lockUserForCapCheck,
  lockTenantForCapCheck,
} from '../repositories/limitRepository.js'
import {
  createMandateCheckout,
  chargePlanChange,
  cancelRemoteSubscription,
  repairSchedule,
  scheduleDowngradeReplacement,
} from './billingSaga.js'
import { executeDowngradePurge } from './entitlementPurgeService.js'
import { dispatchUserNotification, pushUserNotification } from './notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from './notificationTypes.js'
import { priceForInterval, trialEndFrom, MANDATE_AMOUNT_CENTS } from './billingShared.js'
import {
  isPlatformBillingConfigured,
  PaymentProviderError,
  PAYMENT_STATUS,
} from '../billing/paymentProvider/index.js'
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  LIMITS,
  mergeEntitlements,
  featuresToPurge,
} from '../auth/entitlements.js'
import { parsePlanSelection, parseDowngradeSelection } from '../validators/billingValidators.js'
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

const MB = 1024 * 1024

// Capacity precheck against the TARGET plan's limits. With `lock: true` (the
// confirm transaction) it acquires the exact lock set every capacity-growing
// write takes — user row, then per owned tenant (id-ascending) the tenant row
// + tenant advisory lock — so a member add / upload / band unarchive can't
// slip past the check while the downgrade commits. Preview runs it lock-free.
async function computeDowngradeBlockers(executor, userId, targetLimits, { lock = false } = {}) {
  const blockers = []
  if (lock) await lockUserForCapCheck(executor, userId)
  // Archived tenants are checked against the per-tenant limits too — they can
  // be unarchived onto the target plan. Only the band cap counts active ones
  // (archiving is the documented way to satisfy it).
  const tenants = await listOwnedTenants(executor, userId)

  const bandsLimit = targetLimits[LIMITS.BANDS]
  const activeCount = tenants.filter((t) => !t.archived_at).length
  if (bandsLimit !== null && activeCount > bandsLimit) {
    blockers.push({ tenantId: null, tenantName: null, limit: LIMITS.BANDS, current: activeCount, target: bandsLimit })
  }

  const membersLimit = targetLimits[LIMITS.MEMBERS]
  const storageLimitMb = targetLimits[LIMITS.STORAGE_MB]
  for (const tenant of tenants) {
    if (lock) {
      await lockTenantForCapCheck(executor, tenant.id)
      await executor.query('SELECT pg_advisory_xact_lock($1)', [tenant.id])
    }
    if (membersLimit !== null) {
      const current = Math.max(
        await countRosterMembers(executor, tenant.id),
        await countApprovedMemberships(executor, tenant.id),
      )
      if (current > membersLimit) {
        blockers.push({ tenantId: tenant.id, tenantName: tenant.band_name, limit: LIMITS.MEMBERS, current, target: membersLimit })
      }
    }
    if (storageLimitMb !== null) {
      const bytes = await getTenantStorageBytes(executor, tenant.id)
      if (bytes > storageLimitMb * MB) {
        blockers.push({
          tenantId: tenant.id, tenantName: tenant.band_name, limit: LIMITS.STORAGE_MB,
          current: Math.ceil(bytes / MB), target: storageLimitMb,
        })
      }
    }
  }
  return blockers
}

// Shared target-plan validation for preview + confirm. Fallback plans skip
// pricing entirely (the 0/cancel path); any other target must carry a real
// price for the chosen interval.
async function loadDowngradeTarget(db, planId, interval) {
  const targetPlan = await fetchPlan(db, planId)
  if (!targetPlan || !targetPlan.is_active) {
    return { error: { status: 404, body: { error: 'Plan not found' } } }
  }
  if (targetPlan.is_fallback) return { targetPlan, price: 0 }
  const price = priceForInterval(targetPlan, interval)
  if (price === null || price <= 0) {
    return badRequest('This plan is not available for the chosen interval', 'plan_not_priced')
  }
  return { targetPlan, price }
}

async function notifyDowngradeScheduled(sub, body) {
  const title = 'Downgrade scheduled'
  const { inserted } = await dispatchUserNotification({
    userId: sub.user_id,
    type: BILLING_NOTIFICATION_TYPES.DOWNGRADE_SCHEDULED,
    title, body, url: '/billing',
    dedupeKey: `billing-downgrade-scheduled:${sub.id}`,
  })
  if (inserted) {
    pushUserNotification(sub.user_id, {
      type: BILLING_NOTIFICATION_TYPES.DOWNGRADE_SCHEDULED, title, body, url: '/billing',
    })
  }
}

// Read-only preview for the confirm dialog: what would be lost, the limit
// snapshot that will bind immediately, and any capacity blockers.
export async function previewDowngrade(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parsePlanSelection(body)
  if (parsed.error) return badRequest(parsed.error)

  const target = await loadDowngradeTarget(db, parsed.planId, parsed.interval)
  if (target.error) return target
  const { targetPlan } = target

  const sub = await fetchLiveSubscriptionForUser(db, user.id)
  if (!sub) return { error: { status: 404, body: { error: 'No subscription' } } }

  // Effective entitlements on BOTH sides: per-subscription overrides survive
  // the plan switch, so an override-granted feature is never previewed (or
  // later purged) as lost.
  const effCurrent = mergeEntitlements(sub.plan_entitlements, sub.entitlement_overrides)
  const effTarget = mergeEntitlements(targetPlan.entitlements, sub.entitlement_overrides)
  const blockers = await computeDowngradeBlockers(db, user.id, effTarget.limits)

  return {
    isDowngrade: isDowngrade(effCurrent, effTarget),
    isFreeFallback: Boolean(targetPlan.is_fallback),
    features: featuresToPurge(effCurrent, effTarget),
    limitsSnapshot: effTarget.limits,
    blockers,
  }
}

// Confirmed downgrade. Three branches, all with informed consent (the typed
// phrase) and NO data loss before the target plan is real:
//  - free fallback (non-trial): cancel-at-period-end + manifest → the purge
//    runs when the period-end cancel finalizes.
//  - paid lower tier (non-trial): pending change + frozen manifest; at period
//    end access fallback-locks until the replacement subscription's first
//    charge is PAID (activation switches the plan and only then purges); a
//    terminally failed replacement cancels WITHOUT purging.
//  - trial: the target is real immediately (free switch or immediate cancel),
//    so the manifest persists first and the purge runs right after commit.
export async function downgrade(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseDowngradeSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { planId, interval, confirmation } = parsed

  const target = await loadDowngradeTarget(db, planId, interval)
  if (target.error) return target
  const { targetPlan, price } = target

  const client = await db.connect()
  let after = null
  try {
    await client.query('BEGIN')
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (!sub) { await client.query('ROLLBACK'); return { error: { status: 404, body: { error: 'No subscription' } } } }
    if (sub.is_complimentary) { await client.query('ROLLBACK'); return COMPLIMENTARY }
    if (!sub.mollie_mandate_id) { await client.query('ROLLBACK'); return conflict('No valid payment mandate', 'no_mandate') }
    if (sub.status === 'pending_mandate' || sub.status === 'pending_activation') {
      await client.query('ROLLBACK'); return conflict('The subscription is not active yet', 'plan_change_in_progress')
    }
    if (sub.cancel_at_period_end) { await client.query('ROLLBACK'); return conflict('Resume the subscription before changing plans', 'plan_change_in_progress') }
    if (sub.pending_plan_id) { await client.query('ROLLBACK'); return conflict('A plan change is in progress', 'plan_change_in_progress') }
    if (targetPlan.id === sub.plan_id && interval === sub.billing_interval) {
      await client.query('ROLLBACK'); return badRequest('Already on this plan')
    }

    const effCurrent = mergeEntitlements(sub.plan_entitlements, sub.entitlement_overrides)
    const effTarget = mergeEntitlements(targetPlan.entitlements, sub.entitlement_overrides)
    if (!isDowngrade(effCurrent, effTarget)) {
      await client.query('ROLLBACK'); return badRequest('The chosen plan is not a downgrade', 'not_a_downgrade')
    }

    const expected = `downgrade to ${targetPlan.slug}`
    if (confirmation.trim().toLowerCase() !== expected.toLowerCase()) {
      await client.query('ROLLBACK')
      return badRequest(`Type "${expected}" to confirm`, 'confirmation_mismatch')
    }

    // Capacity precheck under the full lock set; growth writes hold the same
    // locks, so nothing can slip over the target limits while this commits.
    const blockers = await computeDowngradeBlockers(client, user.id, effTarget.limits, { lock: true })
    if (blockers.length) {
      await client.query('ROLLBACK')
      return { error: { status: 409, body: { error: 'Current usage exceeds the target plan limits', code: 'over_target_limit', blockers } } }
    }

    // Frozen at confirmation: the manifest can only SHRINK at execution.
    const manifest = { features: featuresToPurge(effCurrent, effTarget) }
    const snapshot = effTarget.limits

    if (sub.status === 'trialing') {
      // Manifest first, so the immediate post-commit purge has its scope even
      // if the process dies in between (the scheduler safety net resumes it).
      await setPurgeManifest(client, sub.id, { manifest, snapshot })
      if (targetPlan.is_fallback) {
        await cancelSubscriptionNow(client, sub.id, 'user_requested')
        after = { kind: 'trial_fallback', sub }
      } else {
        await switchPlanTrial(client, sub.id, { planId, interval, priceCents: price })
        after = { kind: 'trial_paid', sub }
      }
    } else if (targetPlan.is_fallback) {
      await setDowngradeCancel(client, sub.id, { manifest, snapshot })
      after = { kind: 'fallback', sub }
    } else {
      await setDowngradePending(client, sub.id, { planId, interval, priceCents: price, manifest, snapshot })
      after = { kind: 'paid', sub }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  // Remote / follow-up work, all outside the transaction and all resumable:
  // the durable markers (cancel_at_period_end, downgrade_schedule_pending,
  // manifest) let the scheduler finish anything that fails here.
  const { kind, sub } = after
  if (kind === 'fallback' || kind === 'trial_fallback') {
    await cancelRemoteSubscription(pool, sub).catch((err) =>
      logger.error('billing.cancel_remote_failed', { err, subscriptionId: sub.id }))
  }
  if (kind === 'paid') {
    await scheduleDowngradeReplacement(pool, sub.id).catch((err) =>
      logger.error('billing.downgrade_schedule_failed', { err, subscriptionId: sub.id }))
  }
  if (kind === 'trial_paid') {
    await repairSchedule(pool, sub.id).catch((err) =>
      logger.error('billing.trial_change_repair_failed', { err, subscriptionId: sub.id }))
  }
  if (kind === 'trial_fallback' || kind === 'trial_paid') {
    await executeDowngradePurge(pool, sub.id).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: sub.id }))
  }

  const immediate = kind === 'trial_fallback' || kind === 'trial_paid'
  await notifyDowngradeScheduled(sub, immediate
    ? `Your plan is now ${targetPlan.slug}.`
    : `Your downgrade to ${targetPlan.slug} takes effect at the end of the current billing period.`)
  logger.info('billing.downgrade_scheduled', { subscriptionId: sub.id, planId: targetPlan.id, planSlug: targetPlan.slug })

  return { scheduled: true, immediate, targetPlanSlug: targetPlan.slug }
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
    // A confirmed downgrade (paid pending change OR fallback cancel) whose
    // limits snapshot is already binding capacity growth.
    downgradeScheduled: Boolean(sub.downgrade_confirmed_at),
    pendingLimitsSnapshot: sub.pending_limits_snapshot ?? null,
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
