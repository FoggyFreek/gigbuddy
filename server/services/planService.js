// Subscription plan catalog domain logic. Plans are platform-level (no tenant
// scope); routes gate access to super admins. Expected failures return
// { error: { status, body } }; success returns a domain payload.
//
// Invariants enforced here (with DB backstops in migration 100):
// - Pricing: null = interval unavailable, 0 = free (fallback plan only),
//   > 0 = paid cents.
// - The fallback plan stays active, free, complete, and keeps its identity:
//   it cannot be deleted, deactivated, renamed, or re-priced, and the
//   fallback designation itself cannot be moved via the API.
// - Stored entitlements are always complete (shared/entitlements.js).
import {
  listPlans as listPlanRows,
  fetchPlan,
  insertPlan,
  updatePlanFields,
  deletePlan as deletePlanRow,
} from '../repositories/planRepository.js'
import { validateEntitlements } from '../auth/entitlements.js'
import { invalidatePlanCache } from './entitlementService.js'
import {
  isValidSlug,
  isValidName,
  isValidPriceCents,
  buildPlanUpdateFields,
} from '../validators/planValidators.js'

const NOT_FOUND = { status: 404, body: { error: 'Plan not found' } }

function badRequest(error) {
  return { status: 400, body: { error } }
}

function validateRenameField(valid, isFallback, invalidMessage) {
  if (isFallback) return 'The fallback plan cannot be renamed'
  return valid ? null : invalidMessage
}

function validateActiveField(isActive, isFallback) {
  if (typeof isActive !== 'boolean') return 'is_active must be a boolean'
  if (isFallback && !isActive) return 'The fallback plan cannot be deactivated'
  return null
}

function validatePriceField(field, value, isFallback) {
  if (!isValidPriceCents(value)) {
    return `${field} must be null (unavailable) or a non-negative integer in cents`
  }
  if (isFallback && value !== 0) return 'The fallback plan must remain free (price 0)'
  if (!isFallback && value === 0) return 'Only the fallback plan may have a price of 0'
  return null
}

function validateEntitlementsField(entitlements) {
  const errors = validateEntitlements(entitlements)
  return errors.length > 0 ? `Invalid entitlements: ${errors.join('; ')}` : null
}

// Validates the fields present in `body`. `plan` is the existing row on
// update (null on create) — fallback plans get the stricter integrity rules.
function validatePlanFields(body, plan) {
  const isFallback = plan?.is_fallback ?? false

  if ('is_fallback' in body) {
    return badRequest('The fallback designation cannot be changed')
  }
  // Checked in insertion order; only fields present in `body` are validated.
  const checks = {
    slug: () => validateRenameField(
      isValidSlug(body.slug), isFallback,
      'Invalid slug: use lowercase letters, digits, and hyphens',
    ),
    name: () => validateRenameField(isValidName(body.name), isFallback, 'Name is required'),
    is_active: () => validateActiveField(body.is_active, isFallback),
    sort_order: () => (Number.isInteger(body.sort_order) ? null : 'sort_order must be an integer'),
    monthly_price_cents: () => validatePriceField('monthly_price_cents', body.monthly_price_cents, isFallback),
    yearly_price_cents: () => validatePriceField('yearly_price_cents', body.yearly_price_cents, isFallback),
    entitlements: () => validateEntitlementsField(body.entitlements),
  }
  for (const [field, check] of Object.entries(checks)) {
    if (!(field in body)) continue
    const error = check()
    if (error) return badRequest(error)
  }
  return null
}

export async function listPlans(db) {
  return listPlanRows(db)
}

export async function createPlan(db, body) {
  if ('is_fallback' in body) {
    return { error: badRequest('The fallback designation cannot be changed') }
  }
  // Every key is present in the candidate, so validatePlanFields also acts as
  // the required-field check (slug, name, and complete entitlements).
  const plan = {
    slug: body.slug,
    name: body.name,
    monthly_price_cents: body.monthly_price_cents ?? null,
    yearly_price_cents: body.yearly_price_cents ?? null,
    entitlements: body.entitlements,
    is_active: body.is_active ?? true,
    sort_order: body.sort_order ?? 0,
  }
  const error = validatePlanFields(plan, null)
  if (error) return { error }

  try {
    const created = await insertPlan(db, plan)
    invalidatePlanCache()
    return { plan: created }
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'A plan with this slug already exists' } } }
    }
    throw err
  }
}

export async function updatePlan(db, planId, body) {
  const existing = await fetchPlan(db, planId)
  if (!existing) return { error: NOT_FOUND }

  const error = validatePlanFields(body, existing)
  if (error) return { error }

  const { fields, values } = buildPlanUpdateFields(body)
  if (fields.length === 0) return { plan: existing }

  try {
    const plan = await updatePlanFields(db, planId, fields, values)
    if (!plan) return { error: NOT_FOUND }
    invalidatePlanCache()
    return { plan }
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'A plan with this slug already exists' } } }
    }
    throw err
  }
}

export async function deletePlan(db, planId) {
  const existing = await fetchPlan(db, planId)
  if (!existing) return { error: NOT_FOUND }
  if (existing.is_fallback) {
    return { error: badRequest('The fallback plan cannot be deleted') }
  }
  try {
    await deletePlanRow(db, planId)
  } catch (err) {
    // FK RESTRICT from future subscription rows — the plan is in use.
    if (err.code === '23503') {
      return { error: { status: 409, body: { error: 'Plan is in use by existing subscriptions' } } }
    }
    throw err
  }
  invalidatePlanCache()
  return { slug: existing.slug }
}
