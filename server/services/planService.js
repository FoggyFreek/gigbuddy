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

const PRICE_FIELDS = ['monthly_price_cents', 'yearly_price_cents']

// Validates the fields present in `body`. `plan` is the existing row on
// update (null on create) — fallback plans get the stricter integrity rules.
function validatePlanFields(body, plan) {
  const isFallback = plan?.is_fallback ?? false

  if ('is_fallback' in body) {
    return badRequest('The fallback designation cannot be changed')
  }
  if ('slug' in body) {
    if (isFallback) return badRequest('The fallback plan cannot be renamed')
    if (!isValidSlug(body.slug)) {
      return badRequest('Invalid slug: use lowercase letters, digits, and hyphens')
    }
  }
  if ('name' in body) {
    if (isFallback) return badRequest('The fallback plan cannot be renamed')
    if (!isValidName(body.name)) return badRequest('Name is required')
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return badRequest('is_active must be a boolean')
    if (isFallback && !body.is_active) {
      return badRequest('The fallback plan cannot be deactivated')
    }
  }
  if ('sort_order' in body && !Number.isInteger(body.sort_order)) {
    return badRequest('sort_order must be an integer')
  }
  for (const field of PRICE_FIELDS) {
    if (!(field in body)) continue
    if (!isValidPriceCents(body[field])) {
      return badRequest(`${field} must be null (unavailable) or a non-negative integer in cents`)
    }
    if (isFallback && body[field] !== 0) {
      return badRequest('The fallback plan must remain free (price 0)')
    }
    if (!isFallback && body[field] === 0) {
      return badRequest('Only the fallback plan may have a price of 0')
    }
  }
  if ('entitlements' in body) {
    const errors = validateEntitlements(body.entitlements)
    if (errors.length > 0) return badRequest(`Invalid entitlements: ${errors.join('; ')}`)
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
