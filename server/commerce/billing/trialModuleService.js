// Cross-domain trial hook used when a workspace is created. Workspace creation
// owns the transaction; this helper only attaches the matching Gold trial
// module and never calls the payment provider.
import { fetchTrialTierPlan } from '../plans/planRepository.js'
import { fetchLiveSubscriptionForUpdate } from './subscriptionRepository.js'
import { listModulesForUpdate, insertModule } from './subscriptionModuleRepository.js'
import { PLAN_AUDIENCES } from '../../../shared/planAudiences.js'

// A personal workspace created during a Band Gold trial joins that SAME trial.
// The original trial_ends_at is deliberately untouched.
export async function attachArtistGoldToBandTrial(executor, userId) {
  const sub = await fetchLiveSubscriptionForUpdate(executor, userId)
  if (!sub || sub.status !== 'trialing') return null

  const modules = await listModulesForUpdate(executor, sub.id)
  if (modules.some((m) => m.audience === PLAN_AUDIENCES.ARTIST)) return null

  const bandTrialPlan = await fetchTrialTierPlan(executor, PLAN_AUDIENCES.BAND)
  const bandModule = modules.find((m) => m.audience === PLAN_AUDIENCES.BAND)
  if (!bandTrialPlan || bandModule?.plan_id !== bandTrialPlan.id) return null

  const artistTrialPlan = await fetchTrialTierPlan(executor, PLAN_AUDIENCES.ARTIST)
  if (!artistTrialPlan) {
    throw new Error('Artist Gold trial tier is not configured')
  }

  await insertModule(executor, {
    subscription_id: sub.id,
    plan_id: artistTrialPlan.id,
    status: 'active',
    price_cents: 0,
  })
  return sub.id
}
