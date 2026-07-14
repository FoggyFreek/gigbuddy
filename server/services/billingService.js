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
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
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
import { BILLING_NOTIFICATION_TYPES } from '../domain/notificationTypes.js'
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
import { badRequest, conflict } from './serviceErrors.js'
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
  const { planId, interval, redirect } = parsed

  const plan = await fetchPlan(db, planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) return badRequest('The free plan needs no subscription')
  const price = priceForInterval(plan, interval)
  if (price === null) return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })
  if (price <= 0) return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })

  const existing = await fetchLiveSubscriptionForUser(db, user.id)
  if (existing) {
    // An interrupted signup for THIS exact plan/interval left a pending_mandate
    // row: the mandate checkout was created but the browser never returned (lost
    // response), or the provider call errored before we could hand back a URL.
    // Resume it instead of 409ing the user into the 24h stale-signup cleanup —
    // createMandateCheckout is idempotent (it recovers the URL from the still-
    // open payment, or re-issues one after a failed attempt). A DIFFERENT plan
    // is a real conflict (one live subscription per user).
    if (existing.status === 'pending_mandate' && existing.plan_id === planId && existing.billing_interval === interval) {
      return startMandateCheckout(db, existing, user, redirect, existing.trial_ends_at !== null)
    }
    return conflict('You already have an active subscription', { code: 'already_subscribed' })
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
    if (err.code === '23505') return conflict('You already have an active subscription', { code: 'already_subscribed' })
    throw err
  }

  return startMandateCheckout(db, sub, user, redirect, trialEligible)
}

// Create (or resume) the €0.01 mandate checkout for a committed pending_mandate
// row and mirror the open payment locally. Remote work runs with local state
// already committed, so a failure here just leaves the pending_mandate row for
// the scheduler (or a later resume) to finish. Idempotent: re-recording the
// same still-open payment is inert.
async function startMandateCheckout(db, sub, user, redirect, trialEligible) {
  try {
    const { paymentId, checkoutUrl } = await createMandateCheckout(db, sub, {
      email: user.email, name: user.name, amountCents: MANDATE_AMOUNT_CENTS, redirect,
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
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction({ error: { status: 404, body: { error: 'No subscription' } } })
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.cancel_at_period_end) return { alreadyScheduled: true }

    // A pending upgrade/interval change mid-flight must not be stranded (a
    // settling charge would take money for a subscription about to cancel).
    if (sub.pending_plan_id && sub.pending_change_kind !== 'downgrade') {
      const inFlight = sub.mollie_schedule_stale || (await isPendingChargeNonterminal(client, sub))
      if (inFlight) abortTransaction(conflict('A plan change is in progress', { code: 'plan_change_in_progress' }))
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
    return { canceled: true, atPeriodEnd: hasPaidPeriod, sub }
  }, { db })

  if (!outcome.canceled) return outcome

  // Remote: stop the provider schedule (idempotent). Outside the txn.
  await cancelRemoteSubscription(pool, outcome.sub).catch((err) =>
    logger.error('billing.cancel_remote_failed', { err, subscriptionId: outcome.sub.id }))
  return { canceled: true, atPeriodEnd: outcome.atPeriodEnd }
}

async function isPendingChargeNonterminal(executor, sub) {
  if (!sub.pending_payment_id) return false
  const payment = await fetchPaymentByMollieId(executor, sub.pending_payment_id)
  return Boolean(payment && (payment.status === PAYMENT_STATUS.OPEN || payment.status === PAYMENT_STATUS.PENDING))
}

// ---- resume ----

export async function resumeSubscription(db, userId) {
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction({ error: { status: 404, body: { error: 'No subscription' } } })
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (!sub.cancel_at_period_end) abortTransaction(badRequest('Nothing to resume'))
    if (sub.current_period_end && new Date(sub.current_period_end) <= new Date()) {
      abortTransaction(conflict('The subscription period has already ended', { code: 'already_ended' }))
    }
    await clearCancelAtPeriodEnd(client, sub.id)
    await setScheduleStale(client, sub.id, true) // recreate the provider schedule
    return { resumed: true, subId: sub.id }
  }, { db })

  if (!outcome.resumed) return outcome

  await repairSchedule(pool, outcome.subId).catch((err) =>
    logger.error('billing.resume_repair_failed', { err, subscriptionId: outcome.subId }))
  return { resumed: true }
}

// ---- change plan (upgrade / interval only; downgrade → dedicated endpoint) ----

// Guards shared by every plan-change attempt on the locked subscription row.
// Pure: returns the error result or null; the caller owns the rollback.
function planChangeGuardError(sub) {
  if (!sub) return { error: { status: 404, body: { error: 'No subscription' } } }
  if (sub.is_complimentary) return COMPLIMENTARY
  if (!sub.mollie_mandate_id) return conflict('No valid payment mandate', { code: 'no_mandate' })
  if (sub.pending_plan_id) return conflict('A plan change is in progress', { code: 'plan_change_in_progress' })
  if (sub.cancel_at_period_end) return conflict('Resume the subscription before changing plans', { code: 'plan_change_in_progress' })
  return null
}

function classifyPlanChange(sub, targetPlan, interval) {
  if (targetPlan.id === sub.plan_id && interval === sub.billing_interval) return 'same'
  if (targetPlan.id === sub.plan_id) return 'interval'
  return isDowngrade(sub.plan_entitlements, targetPlan.entitlements) ? 'downgrade' : 'upgrade'
}

// Remote on-demand charge for a committed pending change, outside the txn.
async function chargePendingPlanChange(charge) {
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

export async function changePlan(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parsePlanSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { planId, interval } = parsed

  const targetPlan = await fetchPlan(db, planId)
  if (!targetPlan || !targetPlan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (targetPlan.is_fallback) return badRequest('Use downgrade to move to the free plan', { code: 'use_downgrade_endpoint' })
  const price = priceForInterval(targetPlan, interval)
  if (price === null || price <= 0) return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    const guardError = planChangeGuardError(sub)
    if (guardError) abortTransaction(guardError)

    const kind = classifyPlanChange(sub, targetPlan, interval)
    if (kind === 'same') abortTransaction(badRequest('Already on this plan'))
    if (kind === 'downgrade') abortTransaction(badRequest('Use the downgrade endpoint for a lower tier', { code: 'use_downgrade_endpoint' }))

    if (sub.status === 'trialing') {
      // Trial is free: switch immediately, recreate the schedule at the new
      // amount before the trial ends (repair stages only, no charge).
      await switchPlanTrial(client, sub.id, { planId, interval, priceCents: price })
      return { trial: true, subId: sub.id }
    }

    // Active: set pending state (durable) BEFORE the on-demand charge so the
    // paid webhook can classify the charge and activate-first. Entitlements stay
    // unchanged until that charge is paid.
    await setPendingChange(client, sub.id, { planId, kind, interval, priceCents: price })
    return { charge: { sub, planSlug: targetPlan.slug, planId, interval, price } }
  }, { db })

  if (outcome.trial) {
    // Post-commit: recreate the provider schedule at the new amount (best-effort).
    await repairSchedule(pool, outcome.subId).catch((err) =>
      logger.error('billing.trial_change_repair_failed', { err, subscriptionId: outcome.subId }))
    return { changed: true, trial: true }
  }
  if (outcome.charge) return chargePendingPlanChange(outcome.charge)
  return outcome
}

// ---- downgrade (phase 6) ----

const MB = 1024 * 1024

// Capacity precheck against the TARGET plan's limits. With `lock: true` (the
// confirm transaction) it acquires the exact lock set every capacity-growing
// write takes — user row, then per owned tenant (id-ascending) the tenant row
// + tenant advisory lock — so a member add / upload / band unarchive can't
// slip past the check while the downgrade commits. Preview runs it lock-free.
async function tenantDowngradeBlockers(executor, tenant, { membersLimit, storageLimitMb, lock }) {
  const blockers = []
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
  return blockers
}

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
    blockers.push(...await tenantDowngradeBlockers(executor, tenant, { membersLimit, storageLimitMb, lock }))
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
    return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })
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
// Guards on the locked subscription row before a downgrade may be confirmed.
// Pure: returns the error result or null; the caller owns the rollback.
function downgradeGuardError(sub, targetPlan, interval) {
  if (!sub) return { error: { status: 404, body: { error: 'No subscription' } } }
  if (sub.is_complimentary) return COMPLIMENTARY
  if (!sub.mollie_mandate_id) return conflict('No valid payment mandate', { code: 'no_mandate' })
  if (sub.status === 'pending_mandate' || sub.status === 'pending_activation') {
    return conflict('The subscription is not active yet', { code: 'plan_change_in_progress' })
  }
  if (sub.cancel_at_period_end) return conflict('Resume the subscription before changing plans', { code: 'plan_change_in_progress' })
  if (sub.pending_plan_id) return conflict('A plan change is in progress', { code: 'plan_change_in_progress' })
  if (targetPlan.id === sub.plan_id && interval === sub.billing_interval) {
    return badRequest('Already on this plan')
  }
  return null
}

// Persists the branch-specific downgrade state inside the confirm transaction
// and returns the follow-up descriptor for the post-commit work.
async function applyDowngradeBranch(client, sub, targetPlan, { planId, interval, price, manifest, snapshot }) {
  if (sub.status === 'trialing') {
    // Manifest first, so the immediate post-commit purge has its scope even
    // if the process dies in between (the scheduler safety net resumes it).
    await setPurgeManifest(client, sub.id, { manifest, snapshot })
    if (targetPlan.is_fallback) {
      await cancelSubscriptionNow(client, sub.id, 'user_requested')
      return { kind: 'trial_fallback', sub }
    }
    await switchPlanTrial(client, sub.id, { planId, interval, priceCents: price })
    return { kind: 'trial_paid', sub }
  }
  if (targetPlan.is_fallback) {
    await setDowngradeCancel(client, sub.id, { manifest, snapshot })
    return { kind: 'fallback', sub }
  }
  await setDowngradePending(client, sub.id, { planId, interval, priceCents: price, manifest, snapshot })
  return { kind: 'paid', sub }
}

// Remote / follow-up work, all outside the transaction and all resumable:
// the durable markers (cancel_at_period_end, downgrade_schedule_pending,
// manifest) let the scheduler finish anything that fails here.
async function runDowngradeFollowUps({ kind, sub }) {
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
}

export async function downgrade(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseDowngradeSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { planId, interval, confirmation } = parsed

  const target = await loadDowngradeTarget(db, planId, interval)
  if (target.error) return target
  const { targetPlan, price } = target

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    const guardError = downgradeGuardError(sub, targetPlan, interval)
    if (guardError) abortTransaction(guardError)

    const effCurrent = mergeEntitlements(sub.plan_entitlements, sub.entitlement_overrides)
    const effTarget = mergeEntitlements(targetPlan.entitlements, sub.entitlement_overrides)
    if (!isDowngrade(effCurrent, effTarget)) {
      abortTransaction(badRequest('The chosen plan is not a downgrade', { code: 'not_a_downgrade' }))
    }

    const expected = `downgrade to ${targetPlan.slug}`
    if (confirmation.trim().toLowerCase() !== expected.toLowerCase()) {
      abortTransaction(badRequest(`Type "${expected}" to confirm`, { code: 'confirmation_mismatch' }))
    }

    // Capacity precheck under the full lock set; growth writes hold the same
    // locks, so nothing can slip over the target limits while this commits.
    const blockers = await computeDowngradeBlockers(client, user.id, effTarget.limits, { lock: true })
    if (blockers.length) {
      abortTransaction({ error: { status: 409, body: { error: 'Current usage exceeds the target plan limits', code: 'over_target_limit', blockers } } })
    }

    // Frozen at confirmation: the manifest can only SHRINK at execution.
    const manifest = { features: featuresToPurge(effCurrent, effTarget) }
    return {
      after: await applyDowngradeBranch(client, sub, targetPlan, {
        planId, interval, price, manifest, snapshot: effTarget.limits,
      }),
    }
  }, { db })

  if (!outcome.after) return outcome

  const after = outcome.after
  await runDowngradeFollowUps(after)

  const { kind, sub } = after
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
