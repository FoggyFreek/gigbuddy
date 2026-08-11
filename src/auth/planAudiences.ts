import {
  PLAN_AUDIENCES,
  PLAN_AUDIENCE_KEYS,
  isPlanAudience as isPlanAudienceJs,
  audienceForTenantKind as audienceForTenantKindJs,
} from '../../shared/planAudiences.js'
import type { TenantKind } from './tenantKinds.ts'

export { PLAN_AUDIENCES, PLAN_AUDIENCE_KEYS }

export type PlanAudience = (typeof PLAN_AUDIENCES)[keyof typeof PLAN_AUDIENCES]

// Thin typed wrappers over the shared registry: the rules live once in
// shared/planAudiences.js, and these only add the signatures TypeScript cannot
// infer from plain JS — notably the type predicate, which is what lets a query
// param narrow to a PlanAudience.
export function isPlanAudience(value: unknown): value is PlanAudience {
  return isPlanAudienceJs(value)
}

/** Throws on an unrecognised kind — see the shared registry for why. */
export function audienceForTenantKind(kind: TenantKind): PlanAudience {
  return audienceForTenantKindJs(kind)
}
