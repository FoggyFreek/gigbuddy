// Input validation for the billing routes. Pure functions returning either a
// parsed value object or { error: '<message>' }; the service maps errors to 400.
import { BILLING_INTERVAL } from '../billing/paymentProvider/index.js'

const INTERVALS = [BILLING_INTERVAL.MONTH, BILLING_INTERVAL.YEAR]

function parsePlanId(value) {
  const planId = Number(value)
  if (!Number.isInteger(planId) || planId <= 0) return null
  return planId
}

// Where the hosted checkout may send the user back to. Frontend paths only —
// never a caller-supplied URL.
const REDIRECT_TARGETS = ['billing', 'onboarding']

// { planId, interval, redirect } for subscribe and change-plan. `redirect`
// names a whitelisted return page for the mandate checkout (subscribe only;
// change-plan/downgrade have no checkout page and ignore it).
export function parsePlanSelection(body) {
  const planId = parsePlanId(body?.planId)
  if (planId === null) return { error: 'planId must be a positive integer' }
  const interval = body?.interval
  if (!INTERVALS.includes(interval)) return { error: "interval must be 'month' or 'year'" }
  const redirect = body?.redirect ?? 'billing'
  if (!REDIRECT_TARGETS.includes(redirect)) return { error: "redirect must be 'billing' or 'onboarding'" }
  return { planId, interval, redirect }
}

// { planId, interval, confirmation } for the downgrade endpoint. The
// confirmation phrase is validated against the target plan by the service
// (the plan slug isn't known here).
export function parseDowngradeSelection(body) {
  const parsed = parsePlanSelection(body)
  if (parsed.error) return parsed
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation : ''
  return { ...parsed, confirmation }
}

// Admin complimentary grant: { userId, planId, expiresAt? }.
export function parseComplimentaryBody(body) {
  const userId = parsePlanId(body?.userId)
  if (userId === null) return { error: 'userId must be a positive integer' }
  const planId = parsePlanId(body?.planId)
  if (planId === null) return { error: 'planId must be a positive integer' }
  let expiresAt = null
  if (body?.expiresAt != null) {
    const d = new Date(body.expiresAt)
    if (Number.isNaN(d.getTime())) return { error: 'expiresAt must be a valid date' }
    expiresAt = d
  }
  return { userId, planId, expiresAt }
}
