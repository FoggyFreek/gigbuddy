import type { SubscriptionPlan, Subscription, BillingInterval } from '../api/billing.ts'
import type { PlanAudience } from '../auth/planAudiences.ts'

export type PlanAction = 'subscribe' | 'upgrade' | 'downgrade' | 'switch'

// Complimentary grants carry no billing interval, so match on plan id alone;
// otherwise the active plan is the one matching both id and the chosen interval.
export function isCurrentPlan(
  sub: Subscription | null,
  plan: SubscriptionPlan,
  interval: BillingInterval,
): boolean {
  if (!sub) return plan.is_fallback
  return sub.planId === plan.id && (sub.isComplimentary || sub.billingInterval === interval)
}

// Which action a card offers relative to the current plan, WITHIN one ladder:
// sort_order decides upgrade vs downgrade, the same tier switches the interval.
//
// Band and artist are separate products with no path between them, so a plan on
// the other ladder never offers an action. Callers already render one ladder at
// a time; this is the backstop that kept the old code from showing "Upgrade" on
// gold → artist_gold (which the API then rejected).
export function planActionKind(
  plan: SubscriptionPlan,
  sub: Subscription | null,
  isCurrent: boolean,
  currentPlanSortOrder: number,
): PlanAction | null {
  if (isCurrent) return null
  if (sub && sub.audience !== plan.audience) return null
  if (!sub) return plan.is_fallback ? null : 'subscribe'
  if (plan.sort_order > currentPlanSortOrder) return 'upgrade'
  if (plan.sort_order < currentPlanSortOrder) return 'downgrade'
  return 'switch'
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
