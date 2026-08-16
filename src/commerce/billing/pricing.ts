// Pricing types for the frontend. The runtime values come from the single
// source of truth in `shared/pricing.js` — the same module the server prices
// with — so a preview rendered here and the amount actually charged can never
// drift. A parity test in `src/commerce/billing/__tests__/pricing.test.jsx`
// exercises the engine directly.

export {
  BILLING_INTERVALS,
  DISCOUNT_TYPES,
  priceForInterval,
  computePriceSnapshot,
  computeProrationCents,
  validatePriceSnapshot,
} from '../../../shared/pricing.js'

import { DISCOUNT_TYPES as DISCOUNT_TYPE_VALUES } from '../../../shared/pricing.js'
import type { PlanAudience } from '../../auth/planAudiences.ts'
import type { BillingInterval, SubscriptionPlan } from './billing.ts'

export type DiscountType = (typeof DISCOUNT_TYPE_VALUES)[keyof typeof DISCOUNT_TYPE_VALUES]

/**
 * Raw pricing-rule row (snake_case, as the admin CRUD returns it).
 * `percent` arrives as a string — Postgres NUMERIC through node-postgres.
 * Exactly one of `percent` / `amount_cents` is set, chosen by `discount_type`.
 */
export interface PricingRule {
  id: number
  code: string
  version: number
  name: string
  discount_type: DiscountType
  percent: string | null
  amount_cents: number | null
  combinable: boolean
  is_active: boolean
  effective_from: string | null
  effective_to: string | null
  /** All must be present on the subscription; empty means any. */
  required_audiences: PlanAudience[]
  min_module_count: number
  billing_intervals: BillingInterval[]
  priority: number
}

/** One module line of a price snapshot: the plan slug and its list price. */
export interface SnapshotModule {
  plan: string
  priceCents: number
}

/** One applied discount, pinned to the exact rule version that priced it. */
export interface SnapshotDiscount {
  code: string
  /** Human-readable pricing-rule name. Optional on older persisted snapshots. */
  name?: string
  version: number
  type: DiscountType
  /** Percent for a percentage rule, cents for a fixed one. */
  value: number
  amountCents: number
}

/**
 * The complete price snapshot retained for a subscription configuration.
 * `totalCents` always equals `subtotalCents` minus the discount amounts.
 */
export interface PriceSnapshot {
  modules: Partial<Record<PlanAudience, SnapshotModule>>
  subtotalCents: number
  discounts: SnapshotDiscount[]
  totalCents: number
}

/** Input to `computePriceSnapshot`: which plan fills each module slot. */
export interface PricedModule {
  audience: PlanAudience
  plan: SubscriptionPlan
}
