// Stable server import path for the shared entitlements source of truth —
// same pattern as `server/auth/permissions.js`.
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
