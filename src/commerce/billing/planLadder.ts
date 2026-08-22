import type { SubscriptionPlan, Subscription, SubscriptionModule } from './billing.ts'
import type { PlanAudience } from '../../auth/planAudiences.ts'

export type PlanAction = 'add' | 'upgrade' | 'downgrade' | 'remove'

/** The module governing one ladder, or null when the customer has not bought it. */
export function moduleFor(
  sub: Subscription | null,
  audience: PlanAudience,
): SubscriptionModule | null {
  return sub?.modules.find((m) => m.audience === audience) ?? null
}

/**
 * Whether this plan is what the ladder currently sits on. A module scheduled to
 * change still reports its CURRENT plan as current — the change has not happened
 * yet, and pretending otherwise would offer to "upgrade" from a plan the
 * customer is still on.
 */
export function isCurrentPlan(
  module: SubscriptionModule | null,
  plan: SubscriptionPlan,
): boolean {
  if (!module) return plan.is_fallback
  return module.planId === plan.id
}

/**
 * Which action a plan card offers, WITHIN one ladder. sort_order decides upgrade
 * vs downgrade; the free floor is offered as a removal, because "having no
 * module" is exactly what the free plan means now.
 *
 * A plan on the other ladder never offers an action — the caller renders one
 * ladder at a time, and this is the backstop.
 */
export function planActionKind(
  plan: SubscriptionPlan,
  module: SubscriptionModule | null,
  audience: PlanAudience,
  currentPlanSortOrder: number,
): PlanAction | null {
  if (plan.audience !== audience) return null
  if (isCurrentPlan(module, plan)) return null
  if (!module) return plan.is_fallback ? null : 'add'
  if (plan.is_fallback) return 'remove'
  if (plan.sort_order > currentPlanSortOrder) return 'upgrade'
  return 'downgrade'
}

// One ladder's plans, ranked. sort_order is only comparable inside an audience.
export function ladderPlans(
  plans: readonly SubscriptionPlan[],
  audience: PlanAudience,
  { activeOnly = false } = {},
): SubscriptionPlan[] {
  return plans
    .filter((p) => p.audience === audience && (!activeOnly || p.is_active))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** The plan a free trial grants on this ladder, if the catalog designates one. */
export function trialTierPlan(
  plans: readonly SubscriptionPlan[],
  audience: PlanAudience,
): SubscriptionPlan | null {
  return plans.find((p) => p.audience === audience && p.is_trial_tier && p.is_active) ?? null
}
