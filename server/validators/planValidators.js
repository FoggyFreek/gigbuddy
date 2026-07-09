// Input parsing and validation for subscription plan routes. No DB access here.
import { parsePositiveId as parseId } from './common.js'

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

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
