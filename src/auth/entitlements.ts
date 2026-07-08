// Entitlement definitions for the frontend. The runtime values come from the
// single source of truth in `shared/entitlements.js` (the server imports the
// same file via `server/auth/entitlements.js`), so the two can never drift —
// a parity test in `src/tests/entitlements.test.jsx` guards it. This wrapper
// only adds the TypeScript types. The active tenant's resolved entitlements
// arrive on the /auth/me payload (`user.entitlements`).

export {
  FEATURES,
  LIMITS,
  FEATURE_KEYS,
  LIMIT_KEYS,
  ENTITLEMENT_KEYS,
  UNLIMITED,
  isUnlimited,
  validateEntitlements,
  mergeEntitlements,
} from '../../shared/entitlements.js'

import { FEATURES as FEATURES_VALUES, LIMITS as LIMITS_VALUES } from '../../shared/entitlements.js'

export type Feature  = (typeof FEATURES_VALUES)[keyof typeof FEATURES_VALUES]
export type LimitKey = (typeof LIMITS_VALUES)[keyof typeof LIMITS_VALUES]

/** A limit value: a non-negative integer cap, or null for unlimited. */
export type LimitValue = number | null

/**
 * Resolved entitlements for the active tenant, as sent by /auth/me.
 * null on the payload means the tenant has no owner — no enforcement.
 * `limits` already reflects a pending-downgrade snapshot (growth UX).
 */
export interface UserEntitlements {
  planSlug: string
  subscriptionStatus: string | null
  locked: boolean
  financeReadOnly: boolean
  flags: Record<Feature, boolean>
  limits: Record<LimitKey, LimitValue>
}
