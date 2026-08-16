// User-facing billing operations and the read model for the /billing page.
//
// The commercial model: one customer, one subscription, one trial, one cycle,
// one renewal payment. Band and artist are MODULES of that subscription, priced
// together and discounted as a bundle.
//
// Design rules (unchanged from the single-product model, and load-bearing):
// - Local state first: rows are written and committed BEFORE any remote call,
//   so an abandoned checkout is just a stale row the scheduler cleans up.
// - Never a provider call inside a DB transaction.
// - No paid access before an authoritatively-paid subscription charge. The
//   trial is free; its EUR 0.01 continuation verification establishes only the
//   mandate.
// - Every remote mutation goes through the saga layer; this service never calls
//   the provider SDK directly.
// - Expected failures return { error: { status, body } }; success returns a
//   named payload.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  fetchPlan,
  fetchFallbackPlan,
  fetchTrialTierPlan,
  listPlans,
} from '../plans/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchLiveSubscriptionForUpdate,
  fetchSubscriptionById,
  insertSubscription,
  hasUsedTrial,
  setBillingInterval,
  setNextPriceSnapshot,
  setPendingPriceSnapshot,
  setPendingPaymentId,
  clearPendingChange,
  applyModuleChangeActivation,
  setCancelAtPeriodEnd,
  clearCancelAtPeriodEnd,
  cancelSubscriptionNow,
  setScheduleStale,
} from './subscriptionRepository.js'
import {
  listModules,
  listModulesForUpdate,
  fetchModule,
  insertModule,
  setModulePrice,
  switchModulePlan,
  setModulePendingChange,
  setModuleDowngrade,
  setModuleRemoval,
  setModulePurgeManifest,
  clearModulePendingChange,
  deleteModule,
} from './subscriptionModuleRepository.js'
import {
  upsertPaymentOutcome,
  fetchPaymentByMollieId,
  listNonterminalPaymentsForSubscription,
} from './subscriptionPaymentRepository.js'
import { ingestProviderPayment } from './paymentIngestionService.js'
import {
  countActiveOwnedTenants,
  countRosterMembers,
  countApprovedMemberships,
  listOwnedTenants,
  getTenantStorageBytes,
  lockUserForCapCheck,
  lockTenantForCapCheck,
} from './limitRepository.js'
import {
  createConversionCheckout,
  createMandateVerificationCheckout,
  chargeModuleChange,
  cancelRemoteSubscription,
  repairSchedule,
} from './billingSaga.js'
import { executeModulePurge } from './entitlementPurgeService.js'
import { cancelWithRefund } from './subscriptionRefundService.js'
import {
  quote,
  currentModuleSet,
  nextModuleSet,
  computeProrationCents,
  repriceSubscription,
} from './subscriptionPricingService.js'
import { dispatchUserNotification, pushUserNotification } from '../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../domain/notificationTypes.js'
import {
  priceForInterval,
  trialEndFrom,
  refundWindowEndsAt,
  TRIAL_DAYS,
  MANDATE_VERIFICATION_CENTS,
} from './billingShared.js'
import { isPlatformBillingConfigured } from './paymentProvider/providerFactory.js'
import { ProviderError } from './paymentProvider/ProviderError.js'
import { PAYMENT_STATUS } from './paymentProvider/statuses.js'
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  LIMITS,
  mergeEntitlements,
  featuresToPurge,
} from '../../auth/entitlements.js'
import {
  parseModuleSelection,
  parseModuleDowngrade,
  parseCheckout,
  parseAudience,
  parseCancel,
} from './billingValidators.js'
import { PLAN_AUDIENCES, tenantKindsForAudience } from '../../../shared/planAudiences.js'
import { fetchPersonalTenant } from '../../people/workspaces/tenantRepository.js'
import { logger } from '../../utils/logger.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

const NOT_CONFIGURED = { error: { status: 503, body: { error: 'Billing is not configured', code: 'billing_not_configured' } } }
const PROVIDER_ERROR = { error: { status: 502, body: { error: 'Payment provider error', code: 'provider_error' } } }
const COMPLIMENTARY = { error: { status: 409, body: { error: 'This subscription is managed by an administrator', code: 'complimentary_managed_by_admin' } } }
const NO_SUBSCRIPTION = notFound('No subscription')

// A target with any feature removed or any numeric limit reduced (null =
// unlimited = largest) relative to the current plan is a downgrade. Deliberately
// entitlement-shaped, not price-shaped: a bundle discount can make ADDING a
// module cheaper than the current total, and that is not a downgrade.
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

// ---- capacity blockers ----

const MB = 1024 * 1024

// Capacity precheck against a target plan's limits. With `lock: true` it
// acquires the exact lock set every capacity-growing write takes — user row,
// then per owned tenant (id-ascending) the tenant row + tenant advisory lock —
// so a member add / upload / band unarchive cannot slip past while the change
// commits. Preview runs it lock-free.
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

// `audience` scopes the whole check to that module's tenants: an artist module
// is measured against the personal workspace alone, a band module against the
// bands alone. That scoping is also what lets an artist module coexist with
// owned bands — the band cap below simply never runs for the artist ladder.
async function computeModuleBlockers(executor, userId, targetLimits, { audience, lock = false } = {}) {
  const blockers = []
  if (lock) await lockUserForCapCheck(executor, userId)
  // Archived tenants are checked against the per-tenant limits too — they can
  // be unarchived onto the lower plan. Only the band cap counts active ones
  // (archiving is the documented way to satisfy it).
  const tenants = await listOwnedTenants(executor, userId, tenantKindsForAudience(audience))

  // The band cap belongs to the band product. An artist plan's `bands: 0` is
  // vestigial (enforceBandCap reads the band module), so applying it here would
  // block every artist module for anyone who owns a band.
  if (audience === PLAN_AUDIENCES.BAND) {
    const bandsLimit = targetLimits[LIMITS.BANDS]
    const activeCount = tenants.filter((t) => !t.archived_at).length
    if (bandsLimit !== null && activeCount > bandsLimit) {
      blockers.push({ tenantId: null, tenantName: null, limit: LIMITS.BANDS, current: activeCount, target: bandsLimit })
    }
  }

  const membersLimit = targetLimits[LIMITS.MEMBERS]
  const storageLimitMb = targetLimits[LIMITS.STORAGE_MB]
  for (const tenant of tenants) {
    blockers.push(...await tenantDowngradeBlockers(executor, tenant, { membersLimit, storageLimitMb, lock }))
  }
  return blockers
}

// ---- trial ----

// 30 days, once per USER, Gold only, one starter module. No mandate, no
// provider object, no payment — a trial that is never converted simply lapses.
export async function startTrial(db, user, body) {
  const parsed = parseAudience(body)
  if (parsed.error) return badRequest(parsed.error)

  const plan = await fetchTrialTierPlan(db, parsed.audience)
  if (!plan) {
    return conflict('No trial tier is configured for this product', { code: 'trial_tier_missing' })
  }
  const targetLimits = mergeEntitlements(plan.entitlements, null).limits

  return withTransaction(async (client) => {
    const existing = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (existing) abortTransaction(conflict('You already have a subscription', { code: 'already_subscribed' }))
    if (await hasUsedTrial(client, user.id)) {
      abortTransaction(conflict('Your free trial has already been used', { code: 'trial_used' }))
    }

    const blockers = await computeModuleBlockers(client, user.id, targetLimits, {
      audience: parsed.audience, lock: true,
    })
    if (blockers.length > 0) {
      abortTransaction(conflict('Current usage exceeds the trial plan limits', {
        code: 'over_target_limit', blockers,
      }))
    }

    const sub = await insertSubscription(client, {
      user_id: user.id,
      status: 'trialing',
      trial_ends_at: trialEndFrom(),
    })
    // No interval yet, so no list price to snapshot — conversion prices every
    // module against the interval the customer then chooses.
    await insertModule(client, {
      subscription_id: sub.id, plan_id: plan.id, status: 'active',
      price_cents: 0, is_starter: true,
    })
    return { subscription: sub, trialDays: TRIAL_DAYS }
  }, {
    db,
    mapError: (err) => (err.code === '23505'
      ? conflict('You already have a subscription', { code: 'already_subscribed' })
      : null),
  })
}

// ---- module add / change ----

// Loads the locked subscription plus its modules, and the target plan, applying
// the guards every module change shares. Returns { error } or the context.
async function loadModuleChangeContext(client, userId, { audience, planId, requireMandate }) {
  const sub = await fetchLiveSubscriptionForUpdate(client, userId)
  if (!sub) return { error: NO_SUBSCRIPTION.error }
  if (sub.is_complimentary) return COMPLIMENTARY
  if (sub.cancel_at_period_end) {
    return conflict('Resume the subscription before changing it', { code: 'plan_change_in_progress' })
  }
  if (sub.pending_payment_id) {
    return conflict('A change is already in progress', { code: 'plan_change_in_progress' })
  }
  if (requireMandate && !sub.mollie_mandate_id) {
    return conflict('No valid payment mandate', { code: 'no_mandate' })
  }

  const modules = await listModulesForUpdate(client, sub.id)
  if (modules.some((m) => m.status === 'pending'
    || (m.pending_change_kind && !(sub.status === 'trialing'
      && m.pending_change_kind === 'trial_selection')))) {
    return conflict('A change is already in progress', { code: 'plan_change_in_progress' })
  }

  const plan = await fetchPlan(client, planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) {
    return badRequest('The free plan is what having no module means', { code: 'use_downgrade_endpoint' })
  }
  if (plan.audience !== audience) {
    return badRequest('That plan belongs to a different product', { code: 'audience_mismatch' })
  }
  return { sub, modules, plan }
}

// What the customer owes RIGHT NOW for a module change: the positive difference,
// in proportion to the time left in the period they already paid for. A trial
// (or any subscription with no paid period yet) owes nothing — the change simply
// rides into the first charge.
function prorationFor(sub, snapshot) {
  if (sub.status === 'trialing' || !sub.current_period_start || !sub.current_period_end) return 0
  return computeProrationCents({
    oldTotalCents: sub.total_cents ?? 0,
    newTotalCents: snapshot.totalCents,
    periodStart: sub.current_period_start,
    periodEnd: sub.current_period_end,
  })
}

function moduleSetWith(modules, audience, plan) {
  const others = currentModuleSet(modules).filter((m) => m.audience !== audience)
  return [...others, { audience, plan }]
}

// Read-only quote so the UI never asks for a confirmation whose price the user
// has not seen.
export async function previewModuleChange(db, user, body) {
  const parsed = parseModuleSelection(body)
  if (parsed.error) return badRequest(parsed.error)

  const sub = await fetchLiveSubscriptionForUser(db, user.id)
  if (!sub) return NO_SUBSCRIPTION
  const plan = await fetchPlan(db, parsed.planId)
  if (!plan || !plan.is_active || plan.audience !== parsed.audience) {
    return { error: { status: 404, body: { error: 'Plan not found' } } }
  }

  const modules = await listModules(db, sub.id)
  const interval = sub.billing_interval
  if (!interval) {
    // Still trialling: there is no cycle to price against yet.
    return { snapshot: null, prorationCents: 0, isDowngrade: false }
  }
  if (priceForInterval(plan, interval) === null) {
    return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })
  }

  const snapshot = await quote(db, {
    modules: moduleSetWith(modules, parsed.audience, plan), interval,
  })
  const existing = modules.find((m) => m.audience === parsed.audience)
  const downgrade = existing
    ? isDowngrade(
      mergeEntitlements(existing.plan_entitlements, existing.entitlement_overrides),
      mergeEntitlements(plan.entitlements, existing.entitlement_overrides),
    )
    : false

  return {
    snapshot,
    prorationCents: prorationFor(sub, snapshot),
    isDowngrade: downgrade,
  }
}

// Post-commit: charge the prorated difference. Entitlements stay unchanged
// until that charge is paid (activate-first).
async function chargePendingModuleChange({ sub, audience, planId, amountCents, modules }) {
  try {
    const { paymentId } = await chargeModuleChange(pool, sub, {
      audience,
      planId,
      amountCents,
      periodEndIso: new Date(sub.current_period_end).toISOString(),
      modules,
    })
    await setPendingPaymentId(pool, sub.id, paymentId)
    await upsertPaymentOutcome(pool, {
      subscriptionId: sub.id,
      molliePaymentId: paymentId,
      kind: 'proration',
      amountCents,
      status: PAYMENT_STATUS.OPEN,
      mollieCreatedAt: new Date(),
    })
    return { changed: true, pending: true, amountCents }
  } catch (err) {
    // The charge could not be created — roll the pending change back.
    await rollbackPendingModuleChange(sub.id).catch(() => {})
    if (err instanceof ProviderError) return PROVIDER_ERROR
    throw err
  }
}

async function rollbackPendingModuleChange(subId) {
  const modules = await listModules(pool, subId)
  for (const m of modules) {
    if (m.status === 'pending') await deleteModule(pool, m.id)
    else if (m.pending_change_kind === 'upgrade') await clearModulePendingChange(pool, m.id)
  }
  await clearPendingChange(pool, subId)
}

// Add a module the subscription does not have yet, or move an existing one UP.
// During a trial both are free and immediate; on a paid cycle both cost the
// prorated difference and PRESERVE the renewal date.
export async function changeModule(db, user, body) {
  const parsed = parseModuleSelection(body)
  if (parsed.error) return badRequest(parsed.error)
  const { audience, planId } = parsed

  const outcome = await withTransaction(async (client) => {
    const ctx = await loadModuleChangeContext(client, user.id, {
      audience, planId, requireMandate: false,
    })
    if (ctx.error) abortTransaction(ctx)
    const { sub, modules, plan } = ctx

    const existing = modules.find((m) => m.audience === audience)
    const selectedPlanId = existing?.pending_change_kind === 'trial_selection'
      ? existing.pending_plan_id : existing?.plan_id
    if (selectedPlanId === planId) abortTransaction(badRequest('Already on this plan'))

    const targetLimits = mergeEntitlements(plan.entitlements, existing?.entitlement_overrides ?? null).limits
    const blockers = await computeModuleBlockers(client, user.id, targetLimits, { audience, lock: true })
    if (blockers.length > 0) {
      abortTransaction(conflict('Current usage exceeds the target plan limits', {
        code: 'over_target_limit', blockers,
      }))
    }

    // --- trial: Gold access now, independently selected paid plan later ---
    if (sub.status === 'trialing') {
      // Every selected product grants its configured trial tier until the same
      // shared trial end. A different paid plan (for example Band Silver) is a
      // boundary selection: it is priced now but becomes real only when the
      // first scheduled subscription charge settles.
      const trialPlan = await fetchTrialTierPlan(client, audience)
      if (!trialPlan) {
        abortTransaction(conflict('No trial tier is configured for this product', {
          code: 'trial_tier_missing',
        }))
      }
      const paidPrice = sub.billing_interval
        ? priceForInterval(plan, sub.billing_interval) : 0

      let trialModule = existing
      if (!trialModule) {
        trialModule = await insertModule(client, {
          subscription_id: sub.id, plan_id: trialPlan.id, status: 'active', price_cents: 0,
        })
      }

      if (plan.id === trialPlan.id) {
        if (trialModule.pending_change_kind === 'trial_selection') {
          await clearModulePendingChange(client, trialModule.id)
        }
      } else {
        await setModulePendingChange(client, trialModule.id, {
          planId: plan.id, kind: 'trial_selection', priceCents: paidPrice ?? 0,
        })
      }
      return { trial: true, subId: sub.id }
    }

    // --- paid cycle ---
    if (!sub.mollie_mandate_id) abortTransaction(conflict('No valid payment mandate', { code: 'no_mandate' }))
    const interval = sub.billing_interval
    const priceCents = priceForInterval(plan, interval)
    if (priceCents === null || priceCents <= 0) {
      abortTransaction(badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' }))
    }
    if (existing) {
      const effCurrent = mergeEntitlements(existing.plan_entitlements, existing.entitlement_overrides)
      const effTarget = mergeEntitlements(plan.entitlements, existing.entitlement_overrides)
      if (isDowngrade(effCurrent, effTarget)) {
        abortTransaction(badRequest('Use the downgrade endpoint for a lower tier', { code: 'use_downgrade_endpoint' }))
      }
    }

    const snapshot = await quote(client, {
      modules: moduleSetWith(modules, audience, plan), interval,
    })
    const prorationCents = prorationFor(sub, snapshot)

    // A bundle discount can make the larger configuration cost LESS. Nothing is
    // owed, so the change lands immediately; the lower price arrives at renewal.
    if (prorationCents <= 0) {
      if (existing) await switchModulePlan(client, existing.id, { planId, priceCents })
      else {
        await insertModule(client, {
          subscription_id: sub.id, plan_id: planId, status: 'active', price_cents: priceCents,
        })
      }
      await setPendingPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
      return { immediate: true, subId: sub.id }
    }

    // Durable pending state BEFORE the charge, so the paid webhook can classify
    // it and activate-first.
    if (existing) {
      await setModulePendingChange(client, existing.id, { planId, kind: 'upgrade', priceCents })
    } else {
      await insertModule(client, {
        subscription_id: sub.id, plan_id: planId, status: 'pending', price_cents: priceCents,
      })
    }
    await setPendingPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
    return { charge: { sub, audience, planId, amountCents: prorationCents, modules } }
  }, { db })

  if (outcome.error) return outcome

  if (outcome.trial) {
    // If payment was already authorized, keep the delayed trial-end schedule
    // aligned with the newly selected Artist/Band module set.
    await repriceSubscription(pool, outcome.subId).catch((err) =>
      logger.error('billing.reprice_failed', { err, subscriptionId: outcome.subId }))
    await repairSchedule(pool, outcome.subId).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: outcome.subId }))
    return { changed: true, trial: true }
  }
  if (outcome.immediate) {
    // Install the new configuration and re-price the next renewal.
    await applyImmediateModuleChange(outcome.subId)
    return { changed: true, immediate: true }
  }
  if (outcome.charge) return chargePendingModuleChange(outcome.charge)
  return outcome
}

async function applyImmediateModuleChange(subId) {
  await applyModuleChangeActivation(pool, subId)
  await repriceSubscription(pool, subId).catch((err) =>
    logger.error('billing.reprice_failed', { err, subscriptionId: subId }))
  await repairSchedule(pool, subId).catch((err) =>
    logger.error('billing.repair_schedule_failed', { err, subscriptionId: subId }))
}

// ---- conversion ----

// Prices the module set for the chosen interval. A trial pays only the disclosed
// verification cent now; its real combined charge is scheduled at trial end.
// A customer whose trial was already spent still pays the direct-signup
// conversion charge immediately.
export async function checkout(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseCheckout(body)
  if (parsed.error) return badRequest(parsed.error)
  const { interval, redirect } = parsed

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.status === 'active' || sub.status === 'past_due') {
      abortTransaction(conflict('This subscription is already active', { code: 'already_active' }))
    }

    const modules = await listModulesForUpdate(client, sub.id)
    if (modules.length === 0) {
      abortTransaction(badRequest('Choose at least one module first', { code: 'no_modules' }))
    }
    const pricedModules = sub.status === 'trialing'
      ? nextModuleSet(modules)
      : currentModuleSet(modules)
    for (const { plan } of pricedModules) {
      if (priceForInterval(plan, interval) === null) {
        abortTransaction(badRequest('A chosen plan is not available for that interval', { code: 'plan_not_priced' }))
      }
    }

    const snapshot = await quote(client, { modules: pricedModules, interval })
    if (snapshot.totalCents <= 0) {
      abortTransaction(badRequest('This configuration is not available for the chosen interval', { code: 'plan_not_priced' }))
    }

    await setBillingInterval(client, sub.id, interval)
    for (const m of modules) {
      await setModulePrice(client, m.id, priceForInterval(m, interval))
      if (m.pending_change_kind === 'trial_selection') {
        const pendingPlan = {
          monthly_price_cents: m.pending_monthly_price_cents,
          yearly_price_cents: m.pending_yearly_price_cents,
        }
        await setModulePendingChange(client, m.id, {
          planId: m.pending_plan_id,
          kind: 'trial_selection',
          priceCents: priceForInterval(pendingPlan, interval),
        })
      }
    }
    if (sub.status === 'trialing') {
      // This is the exact amount the provider schedule will charge on the
      // displayed trial-end date. Nothing installs a paid period yet.
      await setNextPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
      return { sub: { ...sub, billing_interval: interval }, snapshot, trial: true }
    }

    // Direct paid signup: the conversion payment installs this snapshot.
    await setPendingPriceSnapshot(client, sub.id, { snapshot, totalCents: snapshot.totalCents })
    return { sub: { ...sub, billing_interval: interval }, snapshot, trial: false }
  }, { db })

  if (outcome.error) return outcome

  try {
    if (outcome.trial) {
      if (outcome.sub.mollie_mandate_id) {
        return conflict('Payment is already scheduled', { code: 'already_scheduled' })
      }
      const { paymentId, checkoutUrl } = await createMandateVerificationCheckout(db, outcome.sub, {
        email: user.email,
        name: user.name,
        amountCents: MANDATE_VERIFICATION_CENTS,
        redirect,
      })
      await upsertPaymentOutcome(db, {
        subscriptionId: outcome.sub.id,
        molliePaymentId: paymentId,
        kind: 'mandate_verification',
        amountCents: MANDATE_VERIFICATION_CENTS,
        status: PAYMENT_STATUS.OPEN,
        mollieCreatedAt: new Date(),
      })
      return {
        checkoutUrl,
        subscriptionId: outcome.sub.id,
        verificationCents: MANDATE_VERIFICATION_CENTS,
        totalCents: outcome.snapshot.totalCents,
        subscriptionStartsAt: outcome.sub.trial_ends_at,
      }
    }

    const { paymentId, checkoutUrl } = await createConversionCheckout(db, outcome.sub, {
      email: user.email, name: user.name, amountCents: outcome.snapshot.totalCents, redirect,
    })
    await upsertPaymentOutcome(db, {
      subscriptionId: outcome.sub.id,
      molliePaymentId: paymentId,
      kind: 'conversion',
      amountCents: outcome.snapshot.totalCents,
      status: PAYMENT_STATUS.OPEN,
      mollieCreatedAt: new Date(),
      priceSnapshot: outcome.snapshot,
    })
    return { checkoutUrl, subscriptionId: outcome.sub.id, totalCents: outcome.snapshot.totalCents }
  } catch (err) {
    if (err instanceof ProviderError) return PROVIDER_ERROR
    throw err
  }
}

// Direct signup for a customer whose trial is already spent: create the
// subscription and its first module, then go straight to checkout.
export async function subscribe(db, user, body) {
  if (!isPlatformBillingConfigured()) return NOT_CONFIGURED
  const parsed = parseModuleSelection(body)
  if (parsed.error) return badRequest(parsed.error)

  const plan = await fetchPlan(db, parsed.planId)
  if (!plan || !plan.is_active) return { error: { status: 404, body: { error: 'Plan not found' } } }
  if (plan.is_fallback) return badRequest('The free plan needs no subscription')
  if (plan.audience !== parsed.audience) {
    return badRequest('That plan belongs to a different product', { code: 'audience_mismatch' })
  }

  const created = await withTransaction(async (client) => {
    const existing = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (existing) abortTransaction(conflict('You already have a subscription', { code: 'already_subscribed' }))

    const targetLimits = mergeEntitlements(plan.entitlements, null).limits
    const blockers = await computeModuleBlockers(client, user.id, targetLimits, {
      audience: parsed.audience, lock: true,
    })
    if (blockers.length > 0) {
      abortTransaction(conflict('Current usage exceeds the target plan limits', {
        code: 'over_target_limit', blockers,
      }))
    }

    const sub = await insertSubscription(client, { user_id: user.id, status: 'pending_activation' })
    await insertModule(client, {
      subscription_id: sub.id, plan_id: plan.id, status: 'active',
      price_cents: 0, is_starter: true,
    })
    return { sub }
  }, {
    db,
    mapError: (err) => (err.code === '23505'
      ? conflict('You already have a subscription', { code: 'already_subscribed' })
      : null),
  })
  if (created.error) return created

  return checkout(db, user, body)
}

// ---- downgrade / remove a module ----

// Shared target resolution for preview + confirm. `remove: true` has no target
// plan: the module goes and that ladder falls back to its free floor.
async function loadDowngradeTarget(db, { audience, planId, remove }, interval) {
  if (remove) return { targetPlan: null, price: 0 }
  const targetPlan = await fetchPlan(db, planId)
  if (!targetPlan || !targetPlan.is_active || targetPlan.audience !== audience) {
    return { error: { status: 404, body: { error: 'Plan not found' } } }
  }
  const price = priceForInterval(targetPlan, interval)
  if (price === null || price <= 0) {
    return badRequest('This plan is not available for the chosen interval', { code: 'plan_not_priced' })
  }
  return { targetPlan, price }
}

// The entitlements a module would grant after the change — the target plan's,
// or the ladder's free floor when the module is removed altogether.
async function targetEntitlementsFor(db, audience, targetPlan, overrides) {
  if (targetPlan) return mergeEntitlements(targetPlan.entitlements, overrides)
  const fallback = await fetchFallbackPlan(db, audience)
  return mergeEntitlements(fallback.entitlements, overrides)
}

// Read-only preview for the confirm dialog: what would be lost, the limit
// snapshot that will bind immediately, and any capacity blockers.
export async function previewDowngrade(db, user, body) {
  const parsed = parseModuleDowngrade(body, { requireConfirmation: false })
  if (parsed.error) return badRequest(parsed.error)

  const sub = await fetchLiveSubscriptionForUser(db, user.id)
  if (!sub) return NO_SUBSCRIPTION
  const module = await fetchModule(db, sub.id, parsed.audience)
  if (!module) return notFound('No such module')

  const target = await loadDowngradeTarget(db, parsed, sub.billing_interval)
  if (target.error) return target

  // Effective entitlements on BOTH sides: per-module overrides survive the
  // change, so an override-granted feature is never previewed (or later
  // purged) as lost.
  const effCurrent = mergeEntitlements(module.plan_entitlements, module.entitlement_overrides)
  const effTarget = await targetEntitlementsFor(db, parsed.audience, target.targetPlan, module.entitlement_overrides)
  const blockers = await computeModuleBlockers(db, user.id, effTarget.limits, { audience: parsed.audience })

  const modules = await listModules(db, sub.id)
  const remaining = parsed.remove
    ? currentModuleSet(modules).filter((m) => m.audience !== parsed.audience)
    : moduleSetWith(modules, parsed.audience, target.targetPlan)
  const nextSnapshot = sub.billing_interval && remaining.length > 0
    ? await quote(db, { modules: remaining, interval: sub.billing_interval })
    : null

  return {
    isDowngrade: isDowngrade(effCurrent, effTarget),
    isRemoval: Boolean(parsed.remove),
    features: featuresToPurge(effCurrent, effTarget),
    limitsSnapshot: effTarget.limits,
    blockers,
    nextSnapshot,
    effectiveAt: sub.current_period_end,
  }
}

// Confirmed downgrade or removal. Informed consent first (the typed phrase),
// and NO data loss before the target plan is real: the change is scheduled for
// the period boundary and its purge runs only when the renewal that carries it
// is authoritatively paid.
//
// A trial has nothing paid for, so the change is immediate and so is the purge.
export async function downgrade(db, user, body) {
  const parsed = parseModuleDowngrade(body, { requireConfirmation: true })
  if (parsed.error) return badRequest(parsed.error)
  const { audience, remove, confirmation } = parsed

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, user.id)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.pending_payment_id) {
      abortTransaction(conflict('A change is already in progress', { code: 'plan_change_in_progress' }))
    }

    const modules = await listModulesForUpdate(client, sub.id)
    const module = modules.find((m) => m.audience === audience)
    if (!module) abortTransaction(notFound('No such module'))
    if (module.pending_change_kind
      && !(sub.status === 'trialing' && module.pending_change_kind === 'trial_selection')) {
      abortTransaction(conflict('A change is already in progress', { code: 'plan_change_in_progress' }))
    }

    const target = await loadDowngradeTarget(client, parsed, sub.billing_interval)
    if (target.error) abortTransaction(target)
    const { targetPlan, price } = target
    if (targetPlan && targetPlan.id === module.plan_id) {
      abortTransaction(badRequest('Already on this plan'))
    }

    const effCurrent = mergeEntitlements(module.plan_entitlements, module.entitlement_overrides)
    const effTarget = await targetEntitlementsFor(client, audience, targetPlan, module.entitlement_overrides)
    if (!remove && !isDowngrade(effCurrent, effTarget)) {
      abortTransaction(badRequest('The chosen plan is not a downgrade', { code: 'not_a_downgrade' }))
    }

    const expected = remove ? `remove ${audience}` : `downgrade to ${targetPlan.slug}`
    if (confirmation.trim().toLowerCase() !== expected.toLowerCase()) {
      abortTransaction(badRequest(`Type "${expected}" to confirm`, { code: 'confirmation_mismatch' }))
    }

    // Capacity precheck under the full lock set; growth writes hold the same
    // locks, so nothing can slip over the target limits while this commits.
    const blockers = await computeModuleBlockers(client, user.id, effTarget.limits, {
      audience, lock: true,
    })
    if (blockers.length) {
      abortTransaction(conflict('Current usage exceeds the target plan limits', {
        code: 'over_target_limit', blockers,
      }))
    }

    // Frozen at confirmation: the manifest can only SHRINK at execution.
    const manifest = { features: featuresToPurge(effCurrent, effTarget) }
    const snapshot = effTarget.limits

    // A trial has nothing paid for, so the target is real immediately. The
    // manifest is persisted BEFORE the commit either way, so the scheduler's
    // safety net can finish the purge if this process dies in between.
    if (sub.status === 'trialing') {
      if (remove) {
        if (modules.length === 1) {
          abortTransaction(badRequest('Choose at least one trial module', { code: 'no_modules' }))
        }
        await deleteModule(client, module.id)
        // The row is gone, so the manifest travels with the purge request.
        return { immediate: true, sub, purge: { subscriptionId: sub.id, audience, manifest } }
      }
      await switchModulePlan(client, module.id, { planId: targetPlan.id, priceCents: 0 })
      await setModulePurgeManifest(client, module.id, { manifest, snapshot })
      return { immediate: true, sub, purge: { moduleId: module.id } }
    }

    if (remove) await setModuleRemoval(client, module.id, { manifest, snapshot })
    else {
      await setModuleDowngrade(client, module.id, {
        planId: targetPlan.id, priceCents: price, manifest, snapshot,
      })
    }
    return { scheduled: true, sub, targetSlug: targetPlan?.slug ?? null }
  }, { db })

  if (outcome.error) return outcome

  if (outcome.immediate) {
    await executeModulePurge(pool, outcome.purge).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: outcome.sub.id }))
    await repriceSubscription(pool, outcome.sub.id).catch((err) =>
      logger.error('billing.reprice_failed', { err, subscriptionId: outcome.sub.id }))
    await repairSchedule(pool, outcome.sub.id).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: outcome.sub.id }))
  } else {
    // The next renewal charges the lower amount; repricing marks the provider
    // schedule stale so it is replaced before that charge goes out.
    await repriceSubscription(pool, outcome.sub.id).catch((err) =>
      logger.error('billing.reprice_failed', { err, subscriptionId: outcome.sub.id }))
    await repairSchedule(pool, outcome.sub.id).catch((err) =>
      logger.error('billing.repair_schedule_failed', { err, subscriptionId: outcome.sub.id }))
  }

  await notifyDowngradeScheduled(outcome.sub, audience, outcome.immediate
    ? `Your ${audience} module has been changed.`
    : `Your ${audience} change takes effect at the end of the current billing period.`)
  logger.info('billing.downgrade_scheduled', { subscriptionId: outcome.sub.id })

  return {
    scheduled: true,
    immediate: Boolean(outcome.immediate),
    targetPlanSlug: outcome.targetSlug ?? null,
  }
}

// Keyed per subscription AND module: a customer downgrading both modules should
// hear about both, but a retried request must not notify twice.
async function notifyDowngradeScheduled(sub, audience, body) {
  const title = 'Change scheduled'
  const { inserted } = await dispatchUserNotification({
    userId: sub.user_id,
    type: BILLING_NOTIFICATION_TYPES.DOWNGRADE_SCHEDULED,
    title, body, url: '/billing',
    dedupeKey: `billing-downgrade-scheduled:${sub.id}:${audience}:${sub.current_period_end ?? 'trial'}`,
  })
  if (inserted) {
    pushUserNotification(sub.user_id, {
      type: BILLING_NOTIFICATION_TYPES.DOWNGRADE_SCHEDULED, title, body, url: '/billing',
    })
  }
}

// ---- cancel / resume ----

async function isPendingChargeNonterminal(executor, sub) {
  if (!sub.pending_payment_id) return false
  const payment = await fetchPaymentByMollieId(executor, sub.pending_payment_id)
  return Boolean(payment && (payment.status === PAYMENT_STATUS.OPEN || payment.status === PAYMENT_STATUS.PENDING))
}

export async function cancelSubscription(db, userId, body) {
  const parsed = parseCancel(body)
  if (parsed.error) return badRequest(parsed.error)

  if (parsed.immediate) return cancelWithRefund(db, userId)

  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
    if (sub.is_complimentary) abortTransaction(COMPLIMENTARY)
    if (sub.cancel_at_period_end) return { alreadyScheduled: true }

    // A change mid-flight must not be stranded (a settling charge would take
    // money for a subscription about to cancel).
    if (await isPendingChargeNonterminal(client, sub)) {
      abortTransaction(conflict('A change is in progress', { code: 'plan_change_in_progress' }))
    }

    const hasPaidPeriod = sub.status === 'active' && sub.current_period_end
      && new Date(sub.current_period_end) > new Date()
    if (hasPaidPeriod) {
      await setCancelAtPeriodEnd(client, sub.id, 'user_requested')
    } else {
      // Trial / not-yet-activated / past_due: nothing paid to honor — cancel now.
      await cancelSubscriptionNow(client, sub.id, 'user_requested')
    }
    return { canceled: true, atPeriodEnd: hasPaidPeriod, sub }
  }, { db })

  if (!outcome.canceled) return outcome

  await cancelRemoteSubscription(pool, outcome.sub).catch((err) =>
    logger.error('billing.cancel_remote_failed', { err, subscriptionId: outcome.sub.id }))
  return { canceled: true, atPeriodEnd: outcome.atPeriodEnd }
}

export async function resumeSubscription(db, userId) {
  const outcome = await withTransaction(async (client) => {
    const sub = await fetchLiveSubscriptionForUpdate(client, userId)
    if (!sub) abortTransaction(NO_SUBSCRIPTION)
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

// ---- read model ----

export function serializeSubscription(sub, modules = []) {
  if (!sub) return null
  const refundEligibleUntil = refundWindowEndsAt(sub.last_charge_at)
  return {
    id: sub.id,
    status: sub.status,
    billingInterval: sub.billing_interval,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    trialEndsAt: sub.trial_ends_at,
    convertedAt: sub.converted_at,
    isComplimentary: sub.is_complimentary,
    complimentaryExpiresAt: sub.complimentary_expires_at,
    priceSnapshot: sub.price_snapshot ?? null,
    totalCents: sub.total_cents ?? null,
    nextPriceSnapshot: sub.next_price_snapshot ?? null,
    nextTotalCents: sub.next_total_cents ?? null,
    pendingTotalCents: sub.pending_total_cents ?? null,
    // Inside this window a cancellation is immediate and refunds the charge
    // that opened the period, in full.
    refundEligibleUntil: refundEligibleUntil && refundEligibleUntil > new Date()
      ? refundEligibleUntil.toISOString() : null,
    scheduleStale: sub.mollie_schedule_stale,
    repairNeeded: sub.billing_repair_needed,
    paymentMethodReady: Boolean(sub.mollie_mandate_id),
    paymentVerificationPending: sub.status === 'trialing'
      && (sub.verification_payment_status === PAYMENT_STATUS.OPEN
        || sub.verification_payment_status === PAYMENT_STATUS.PENDING),
    subscriptionStartsAt: sub.status === 'trialing' && sub.mollie_subscription_id
      ? sub.trial_ends_at : null,
    modules: modules.map((m) => ({
      audience: m.audience,
      planId: m.plan_id,
      planSlug: m.plan_slug,
      status: m.status,
      priceCents: m.price_cents,
      isStarter: m.is_starter,
      pendingPlanId: m.pending_plan_id,
      pendingPlanSlug: m.pending_plan_slug,
      pendingChangeKind: m.pending_change_kind,
      pendingLimitsSnapshot: m.pending_limits_snapshot ?? null,
    })),
  }
}

export async function getBillingState(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  const [modules, ownedBandCount, personalTenant, trialUsed, plans, verificationPayment] = await Promise.all([
    sub ? listModules(db, sub.id) : Promise.resolve([]),
    countActiveOwnedTenants(db, userId),
    fetchPersonalTenant(db, userId),
    hasUsedTrial(db, userId),
    listPlans(db),
    sub?.mollie_first_payment_id
      ? fetchPaymentByMollieId(db, sub.mollie_first_payment_id)
      : Promise.resolve(null),
  ])
  const checkoutQuotes = { month: null, year: null }
  if (sub?.status === 'trialing' && modules.length > 0) {
    const selectedModules = nextModuleSet(modules)
    for (const interval of ['month', 'year']) {
      if (selectedModules.every(({ plan }) => priceForInterval(plan, interval) !== null)) {
        checkoutQuotes[interval] = await quote(db, {
          modules: selectedModules, interval,
        })
      }
    }
  }

  return {
    subscription: serializeSubscription(sub
      ? { ...sub, verification_payment_status: verificationPayment?.status ?? null }
      : null, modules),
    trialAvailable: !trialUsed && !sub,
    trialDays: TRIAL_DAYS,
    ownedBandCount,
    hasPersonalWorkspace: personalTenant !== null,
    checkoutQuotes,
    plans: plans.filter((p) => p.is_active),
  }
}

// Manual reconcile for the current user's subscription — the dev "sync" button
// when webhooks are disabled. Re-ingests every nonterminal payment and repairs
// a stale schedule. Safe to call anytime (ingestion is idempotent).
export async function syncOwnSubscription(db, userId) {
  const sub = await fetchLiveSubscriptionForUser(db, userId)
  if (!sub) return { subscription: null }

  for (const p of await listNonterminalPaymentsForSubscription(db, sub.id)) {
    await ingestProviderPayment(sub.id, p.mollie_payment_id).catch((err) =>
      logger.error('billing.sync_ingest_failed', { err, subscriptionId: sub.id }))
  }
  const current = await fetchSubscriptionById(db, sub.id)
  if (current?.mollie_schedule_stale) {
    await repairSchedule(pool, sub.id).catch((err) =>
      logger.error('billing.sync_repair_failed', { err, subscriptionId: sub.id }))
  }
  const fresh = await fetchLiveSubscriptionForUser(db, userId)
  return { subscription: serializeSubscription(fresh, fresh ? await listModules(db, fresh.id) : []) }
}

export { computeModuleBlockers, isDowngrade, nextModuleSet }
