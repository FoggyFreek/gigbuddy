// Adding a module the subscription does not have yet, or moving an existing one
// UP. Lowering or removing one is moduleDowngradeService.js.
//
// Activate-first: durable pending state is committed BEFORE the prorated charge,
// so the paid webhook can classify it. Entitlements only move once that charge
// is authoritatively paid.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { fetchPlan, fetchTrialTierPlan } from '../plans/planRepository.js'
import {
  fetchLiveSubscriptionForUser,
  fetchLiveSubscriptionForUpdate,
  setPendingPriceSnapshot,
  applyModuleChangeActivation,
} from './subscriptionRepository.js'
import {
  listModules,
  listModulesForUpdate,
  insertModule,
  switchModulePlan,
  setModulePendingChange,
  setModuleTrialSelection,
  clearModulePendingChange,
} from './subscriptionModuleRepository.js'
import { changeInFlight } from './pendingChangeKinds.js'
import { chargeModuleChange } from './billingSaga.js'
import { rollbackPendingModuleChange } from './subscriptionModuleChangeRecovery.js'
import { computeModuleBlockers } from '../../entitlements/capacityService.js'
import { repriceAndRepairSchedule } from './billingPostCommit.js'
import {
  quote,
  moduleSetWith,
  computeProrationCents,
} from './subscriptionPricingService.js'
import { priceForInterval } from './billingShared.js'
import { ProviderError } from './paymentProvider/ProviderError.js'
import { mergeEntitlements, isDowngrade } from '../../auth/entitlements.js'
import { parseModuleSelection } from './billingValidators.js'
import { COMPLIMENTARY, NO_SUBSCRIPTION, PROVIDER_ERROR } from './billingErrors.js'
import { badRequest, conflict } from '../../platform/http/serviceErrors.js'

// Loads the locked subscription plus its modules, and the target plan, applying
// the guards every module change shares. Returns { error } or the context.
async function loadModuleChangeContext(client, userId, { audience, planId, requireMandate }) {
  const sub = await fetchLiveSubscriptionForUpdate(client, userId)
  if (!sub) return { error: NO_SUBSCRIPTION.error }
  if (sub.is_complimentary) return COMPLIMENTARY
  if (sub.cancel_at_period_end) {
    return conflict('Resume the subscription before changing it', { code: 'plan_change_in_progress' })
  }
  // Subscription-wide: this flow can issue a prorated charge, which must be
  // attributable to exactly one change.
  const modules = await listModulesForUpdate(client, sub.id)
  if (changeInFlight(sub, modules)) {
    return conflict('A change is already in progress', { code: 'plan_change_in_progress' })
  }
  if (requireMandate && !sub.mollie_mandate_id) {
    return conflict('No valid payment mandate', { code: 'no_mandate' })
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

// Read-only quote so the UI never asks for a confirmation whose price the user
// has not seen.
export async function previewModuleChange(db, user, body) {
  const parsed = parseModuleSelection(body)
  if (parsed.error) return badRequest(parsed.error)

  const sub = await fetchLiveSubscriptionForUser(db, user.id)
  if (!sub) return NO_SUBSCRIPTION
  // Independent reads on the pool, no locks held — the plan lookup and the
  // module list do not depend on each other.
  const [plan, modules] = await Promise.all([
    fetchPlan(db, parsed.planId),
    listModules(db, sub.id),
  ])
  if (!plan || !plan.is_active || plan.audience !== parsed.audience) {
    return { error: { status: 404, body: { error: 'Plan not found' } } }
  }

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
    await chargeModuleChange(pool, sub, {
      audience,
      planId,
      amountCents,
      periodEndIso: new Date(sub.current_period_end).toISOString(),
      modules,
    })
    return { changed: true, pending: true, amountCents }
  } catch (err) {
    // The charge could not be created — roll the pending change back.
    await rollbackPendingModuleChange(pool, sub.id).catch(() => {})
    if (err instanceof ProviderError) return PROVIDER_ERROR
    throw err
  }
}

// --- trial: Gold access now, independently selected paid plan later ---
//
// Every selected product grants its configured trial tier until the same shared
// trial end. A different paid plan (for example Band Silver) is a boundary
// selection: it is priced now but becomes real only when the first scheduled
// subscription charge settles.
//
// `targetLimits` are the limits the selection was just checked against, frozen
// onto the module so they bind for the rest of the trial. The boundary charge
// installs the plan unattended — there is no 409 left in that path — so without
// this the customer could grow to the trial tier's cap over the remaining days
// and land on the selected plan already over it.
//
// Runs inside the caller's transaction; abortTransaction propagates from here.
async function applyTrialModuleSelection(client, { sub, existing, plan, audience, targetLimits }) {
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
    await setModuleTrialSelection(client, trialModule.id, {
      planId: plan.id, priceCents: paidPrice ?? 0, snapshot: targetLimits,
    })
  }
  return { effect: 'trial', subId: sub.id }
}

// --- paid cycle ---
//
// The prorated difference is what the customer owes now; the renewal date is
// deliberately left alone. Same transaction rules as above.
async function applyPaidModuleChange(client, { sub, modules, existing, plan, audience, planId }) {
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
    return { effect: 'immediate', subId: sub.id }
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
  return { effect: 'charge', charge: { sub, audience, planId, amountCents: prorationCents, modules } }
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

    return sub.status === 'trialing'
      ? applyTrialModuleSelection(client, { sub, existing, plan, audience, targetLimits })
      : applyPaidModuleChange(client, { sub, modules, existing, plan, audience, planId })
  }, { db })

  if (outcome.error) return outcome

  switch (outcome.effect) {
    case 'trial':
      // If payment was already authorized, keep the delayed trial-end schedule
      // aligned with the newly selected Artist/Band module set.
      await repriceAndRepairSchedule(outcome.subId)
      return { changed: true, trial: true }
    case 'immediate':
      // Install the new configuration and re-price the next renewal.
      await applyModuleChangeActivation(pool, outcome.subId)
      await repriceAndRepairSchedule(outcome.subId)
      return { changed: true, immediate: true }
    case 'charge':
      return chargePendingModuleChange(outcome.charge)
    default:
      return outcome
  }
}
