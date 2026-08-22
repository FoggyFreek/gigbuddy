// Starting the free trial. See trialModuleService.js for the cross-domain hook
// that attaches a second module to an already-running trial.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { fetchTrialTierPlan } from '../plans/planRepository.js'
import {
  fetchLiveSubscriptionForUpdate,
  insertSubscription,
  hasUsedTrial,
} from './subscriptionRepository.js'
import { insertModule } from './subscriptionModuleRepository.js'
import { computeModuleBlockers } from '../../entitlements/capacityService.js'
import { mergeEntitlements } from '../../auth/entitlements.js'
import { parseAudience } from './billingValidators.js'
import { trialEndFrom, TRIAL_DAYS } from './billingShared.js'
import { badRequest, conflict } from '../../platform/http/serviceErrors.js'

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
