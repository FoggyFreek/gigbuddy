// Input validation for the billing routes. Pure functions returning either a
// parsed value object or { error: '<message>' }; the service maps errors to 400.
import { BILLING_INTERVAL } from './paymentProvider/statuses.js'
import { isPlanAudience } from '../../../shared/planAudiences.js'

const INTERVALS = [BILLING_INTERVAL.MONTH, BILLING_INTERVAL.YEAR]

// Which module an action targets. Never defaulted: a subscription can hold both
// a band and an artist module, and guessing would act on the wrong product.
export function parseAudience(body) {
  const audience = body?.audience
  if (!isPlanAudience(audience)) return { error: "audience must be 'band' or 'artist'" }
  return { audience }
}

function parsePositive(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

// Where the hosted checkout may send the user back to. Frontend paths only —
// never a caller-supplied URL.
const REDIRECT_TARGETS = ['billing', 'onboarding']

function parseRedirect(body) {
  const redirect = body?.redirect ?? 'billing'
  return REDIRECT_TARGETS.includes(redirect) ? redirect : null
}

// { audience, planId } — which module, and which plan it should sit on.
export function parseModuleSelection(body) {
  const audience = parseAudience(body)
  if (audience.error) return audience
  const planId = parsePositive(body?.planId)
  if (planId === null) return { error: 'planId must be a positive integer' }
  return { audience: audience.audience, planId }
}

// { interval, redirect } for the conversion checkout. The interval is shared by
// every module — one subscription, one cycle.
export function parseCheckout(body) {
  const interval = body?.interval
  if (!INTERVALS.includes(interval)) return { error: "interval must be 'month' or 'year'" }
  const redirect = parseRedirect(body)
  if (redirect === null) return { error: "redirect must be 'billing' or 'onboarding'" }
  return { interval, redirect }
}

// { audience, planId?, remove?, confirmation } for the downgrade endpoint.
// `remove: true` drops the module altogether, so it carries no target plan; the
// confirmation phrase is checked against the resolved target by the service
// (the plan slug isn't known here).
export function parseModuleDowngrade(body, { requireConfirmation = true } = {}) {
  const audience = parseAudience(body)
  if (audience.error) return audience

  const remove = body?.remove === true
  let planId = null
  if (!remove) {
    planId = parsePositive(body?.planId)
    if (planId === null) return { error: 'planId must be a positive integer, or pass remove: true' }
  }

  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation : ''
  if (requireConfirmation && confirmation.trim() === '') {
    return { error: 'A confirmation phrase is required' }
  }
  return { audience: audience.audience, planId, remove, confirmation }
}

// { immediate } for the cancel endpoint. `immediate: true` is the withdrawal
// path — it ends access now and refunds the charge that opened the period, and
// the service rejects it outside the window.
export function parseCancel(body) {
  const immediate = body?.immediate
  if (immediate !== undefined && typeof immediate !== 'boolean') {
    return { error: 'immediate must be a boolean' }
  }
  return { immediate: immediate === true }
}

// Admin complimentary grant: { userId, planId, expiresAt? }.
export function parseComplimentaryBody(body) {
  const userId = parsePositive(body?.userId)
  if (userId === null) return { error: 'userId must be a positive integer' }
  const planId = parsePositive(body?.planId)
  if (planId === null) return { error: 'planId must be a positive integer' }
  let expiresAt = null
  if (body?.expiresAt != null) {
    const d = new Date(body.expiresAt)
    if (Number.isNaN(d.getTime())) return { error: 'expiresAt must be a valid date' }
    expiresAt = d
  }
  return { userId, planId, expiresAt }
}

// Admin partial refund: { paymentId, amountCents, note? }. The "already
// refunded ≤ payment amount" rule is a sum, so the service enforces it under a
// row lock; this only rejects shapes.
export function parseAdminRefund(body) {
  const paymentId = parsePositive(body?.paymentId)
  if (paymentId === null) return { error: 'paymentId must be a positive integer' }
  const amountCents = parsePositive(body?.amountCents)
  if (amountCents === null) return { error: 'amountCents must be a positive integer' }
  const note = typeof body?.note === 'string' ? body.note.trim() : null
  return { paymentId, amountCents, note: note || null }
}
