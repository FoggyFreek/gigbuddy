// Lowering a module's plan or removing it altogether — the one flow that can
// DELETE data, so it runs on informed consent first and no data loss before the
// target plan is real.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { fetchPlan, fetchFallbackPlan } from '../plans/planRepository.js'
import { fetchLiveSubscriptionForUser, fetchLiveSubscriptionForUpdate } from './subscriptionRepository.js'
import {
  listModules,
  listModulesForUpdate,
  fetchModule,
  switchModulePlan,
  setModuleDowngrade,
  setModuleRemoval,
  setModulePurgeManifest,
  deleteModule,
} from './subscriptionModuleRepository.js'
import { blocksNewChange } from './pendingChangeKinds.js'
import { executeModulePurge } from './entitlementPurgeService.js'
import { computeModuleBlockers } from '../../entitlements/capacityService.js'
import { repriceAndRepairSchedule } from './billingPostCommit.js'
import { quote, currentModuleSet, moduleSetWith } from './subscriptionPricingService.js'
import { priceForInterval } from './billingShared.js'
import { dispatchUserNotification, pushUserNotification } from '../../user/notifications/notificationService.js'
import { BILLING_NOTIFICATION_TYPES } from '../../domain/notificationTypes.js'
import { mergeEntitlements, featuresToPurge, isDowngrade } from '../../auth/entitlements.js'
import { parseModuleDowngrade } from './billingValidators.js'
import { COMPLIMENTARY, NO_SUBSCRIPTION } from './billingErrors.js'
import { logger } from '../../utils/logger.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

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
  // Independent reads on the pool, no locks held. The guards below still run in
  // their original order, so the reported error is unchanged.
  const [module, target, modules] = await Promise.all([
    fetchModule(db, sub.id, parsed.audience),
    loadDowngradeTarget(db, parsed, sub.billing_interval),
    listModules(db, sub.id),
  ])
  if (!module) return notFound('No such module')
  if (target.error) return target

  // Effective entitlements on BOTH sides: per-module overrides survive the
  // change, so an override-granted feature is never previewed (or later
  // purged) as lost.
  const effCurrent = mergeEntitlements(module.plan_entitlements, module.entitlement_overrides)
  const effTarget = await targetEntitlementsFor(db, parsed.audience, target.targetPlan, module.entitlement_overrides)
  const blockers = await computeModuleBlockers(db, user.id, effTarget.limits, { audience: parsed.audience })

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
    // Per MODULE, not per subscription: a boundary change on one ladder says
    // nothing about the other, and downgrading both is a supported flow.
    if (blocksNewChange(sub, module)) {
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

  // A trial change is real at once, so its purge runs now. A paid one lands at
  // the boundary: repricing marks the provider schedule stale so it is replaced
  // before the renewal that carries the lower amount goes out.
  if (outcome.immediate) {
    await executeModulePurge(pool, outcome.purge).catch((err) =>
      logger.error('billing.purge_failed', { err, subscriptionId: outcome.sub.id }))
  }
  await repriceAndRepairSchedule(outcome.sub.id)

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
