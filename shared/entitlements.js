// Single source of truth for subscription entitlements, shared by the server
// (`server/auth/entitlements.js` re-exports this) and, later, the frontend.
// Authored as plain `.js` because the server runs ESM directly with no build
// step — same pattern as `shared/permissions.js`.
//
// An entitlements object always has exactly two groups:
//   features — boolean flags gating whole capabilities
//   limits   — numeric caps; `null` means unlimited
//
// Plans store a *complete* entitlements object (every key present) so that
// entitlement resolution never has to guess a default for a missing key.

export const FEATURES = Object.freeze({
  FINANCE: 'finance',
  INTEGRATIONS: 'integrations',
  CUSTOMIZATION: 'customization',
  SONG_FILES: 'song_files',
  CHORDPRO: 'chordpro',
  PUBLIC_PROMOTION: 'public_promotion',
  LINKPAGE: 'linkpage',
})

export const LIMITS = Object.freeze({
  STORAGE_MB: 'storage_mb',
  MEMBERS: 'members',
  BANDS: 'bands',
  // Max smart (release) link pages per band; the main link page is not counted.
  LINKPAGE_PAGES: 'linkpage_pages',
  // Rolling statistics window for link pages, in days (30 or 90).
  LINKPAGE_STATS_DAYS: 'linkpage_stats_days',
})

export const FEATURE_KEYS = Object.freeze(Object.values(FEATURES))
export const LIMIT_KEYS = Object.freeze(Object.values(LIMITS))

export const ENTITLEMENT_KEYS = Object.freeze({
  features: FEATURE_KEYS,
  limits: LIMIT_KEYS,
})

// Features whose stored data is deleted when a downgrade makes them durably
// unavailable. `finance` is deliberately absent — financial records are never
// purged (read-only mode instead); `public_promotion` is flag-only (no data);
// `linkpage` data lives in the decoupled linkpage app, which disables the
// pages itself when a content sync reports the feature off — nothing to purge
// on this side.
export const PURGEABLE_FEATURES = Object.freeze([
  FEATURES.INTEGRATIONS,
  FEATURES.CUSTOMIZATION,
  FEATURES.SONG_FILES,
  FEATURES.CHORDPRO,
])

// The purgeable features a move from `current` to `target` effective
// entitlements turns off (true → false). Both sides must be EFFECTIVE
// entitlements (plan merged with per-subscription overrides) so an
// override-granted feature is never classified as lost.
export function featuresToPurge(current, target) {
  return PURGEABLE_FEATURES.filter(
    (feature) => current.features[feature] === true && target.features[feature] === false,
  )
}

// Limits use `null` as the unlimited sentinel (a real JSONB value, unlike
// undefined, and unambiguous next to 0 which means "none allowed").
export const UNLIMITED = null

export function isUnlimited(value) {
  return value === null
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidLimitValue(value) {
  return value === null || (Number.isInteger(value) && value >= 0)
}

// Validates that `entitlements` is a *complete* entitlements object: both
// groups present, every known key present with a valid value, no unknown keys.
// Returns an array of error strings — empty means valid.
export function validateEntitlements(entitlements) {
  if (!isPlainObject(entitlements)) {
    return ['entitlements must be an object with "features" and "limits"']
  }

  const errors = []
  for (const key of Object.keys(entitlements)) {
    if (key !== 'features' && key !== 'limits') errors.push(`unknown entitlement group "${key}"`)
  }

  const { features, limits } = entitlements
  if (!isPlainObject(features)) {
    errors.push('"features" must be an object')
  } else {
    for (const key of FEATURE_KEYS) {
      if (typeof features[key] !== 'boolean') errors.push(`feature "${key}" must be a boolean`)
    }
    for (const key of Object.keys(features)) {
      if (!FEATURE_KEYS.includes(key)) errors.push(`unknown feature "${key}"`)
    }
  }

  if (!isPlainObject(limits)) {
    errors.push('"limits" must be an object')
  } else {
    for (const key of LIMIT_KEYS) {
      if (!isValidLimitValue(limits[key])) {
        errors.push(`limit "${key}" must be null (unlimited) or a non-negative integer`)
      }
    }
    for (const key of Object.keys(limits)) {
      if (!LIMIT_KEYS.includes(key)) errors.push(`unknown limit "${key}"`)
    }
  }

  return errors
}

// Overlays per-subscription overrides on a plan's complete entitlements.
// Only known keys with valid values are applied; anything else is ignored so a
// malformed override can never corrupt the effective entitlements.
export function mergeEntitlements(base, overrides) {
  const features = { ...base.features }
  const limits = { ...base.limits }
  if (isPlainObject(overrides)) {
    if (isPlainObject(overrides.features)) {
      for (const key of FEATURE_KEYS) {
        if (typeof overrides.features[key] === 'boolean') features[key] = overrides.features[key]
      }
    }
    if (isPlainObject(overrides.limits)) {
      for (const key of LIMIT_KEYS) {
        if (key in overrides.limits && isValidLimitValue(overrides.limits[key])) {
          limits[key] = overrides.limits[key]
        }
      }
    }
  }
  return { features, limits }
}
