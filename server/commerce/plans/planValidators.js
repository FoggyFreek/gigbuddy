// Input parsing and validation for subscription plan routes. No DB access here.
import { parsePositiveId as parseId } from '../../platform/http/requestValidators.js'

// Underscores are allowed alongside hyphens: the artist tier shipped as
// 'artist_gold' (migration 160), planLogo.ts keys on the slug, and it appears
// verbatim in the "downgrade to <slug>" confirmation phrase. Rejecting the
// underscore only meant an admin could not recreate the plan through the API —
// and in at least one database it was hand-renamed to 'artistgold' to satisfy
// the old rule.
const SLUG_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/

export { parseId }

export function isValidSlug(value) {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

export function isValidName(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// Pricing semantics: null = interval unavailable, 0 = free (fallback only —
// the service enforces which plans may be 0), > 0 = paid cents.
export function isValidPriceCents(value) {
  return value === null || (Number.isInteger(value) && value >= 0)
}

// Builds SET fragments ($1..$N) from the allowed PATCH fields. Fallback rules,
// price semantics, and entitlement completeness are checked by the service
// before this runs.
//
// `audience` is deliberately absent: it is create-only. Moving a plan between
// ladders would desync subscription_modules.audience on every module bound to
// it (the DB trigger refuses it too).
export function buildPlanUpdateFields(body) {
  const allowed = [
    'slug',
    'name',
    'monthly_price_cents',
    'yearly_price_cents',
    'entitlements',
    'is_active',
    'sort_order',
  ]
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
