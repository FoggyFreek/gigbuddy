// Input parsing and validation for pricing rule routes. Pure — no DB access.
import { parsePositiveId as parseId } from '../../platform/http/requestValidators.js'
import { BILLING_INTERVALS, DISCOUNT_TYPES } from '../../../shared/pricing.js'
import { PLAN_AUDIENCE_KEYS } from '../../../shared/planAudiences.js'

// Same shape as a plan slug: the code is a stable machine identifier that
// appears verbatim inside stored price snapshots.
const CODE_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/

export { parseId }

// The fields that define what a rule charges. Changing any of them creates a
// new version rather than editing in place, so an existing price snapshot
// stays resolvable to the exact terms it was priced with.
export const SEMANTIC_FIELDS = Object.freeze([
  'code',
  'discount_type',
  'percent',
  'amount_cents',
  'combinable',
  'effective_from',
  'effective_to',
  'required_audiences',
  'min_module_count',
  'billing_intervals',
  'priority',
])

function isTimestampOrNull(value) {
  if (value === null || value === undefined) return true
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
}

function isStringArrayWithin(value, allowed, { allowEmpty }) {
  if (!Array.isArray(value)) return false
  if (!allowEmpty && value.length === 0) return false
  return value.every((entry) => allowed.includes(entry))
}

function validateValueForType(rule) {
  if (rule.discount_type === DISCOUNT_TYPES.PERCENTAGE) {
    if (rule.amount_cents !== null) return 'A percentage rule must not carry amount_cents'
    const percent = Number(rule.percent)
    return Number.isFinite(percent) && percent > 0 && percent <= 100
      ? null
      : 'percent must be a number greater than 0 and at most 100'
  }
  if (rule.amount_cents === null || !Number.isInteger(rule.amount_cents) || rule.amount_cents <= 0) {
    return 'amount_cents must be a positive integer'
  }
  return rule.percent === null ? null : 'A fixed rule must not carry percent'
}

// Validates a complete candidate rule (create and new-version take the same
// path — a new version is a fresh set of terms, not a patch).
export function validatePricingRule(rule) {
  if (!CODE_PATTERN.test(String(rule.code ?? ''))) {
    return 'Invalid code: use lowercase letters, digits, hyphens, and underscores'
  }
  if (typeof rule.name !== 'string' || rule.name.trim().length === 0) return 'Name is required'
  if (!Object.values(DISCOUNT_TYPES).includes(rule.discount_type)) {
    return "discount_type must be 'percentage' or 'fixed'"
  }

  const valueError = validateValueForType(rule)
  if (valueError) return valueError

  if (typeof rule.combinable !== 'boolean') return 'combinable must be a boolean'
  if (!isTimestampOrNull(rule.effective_from)) return 'effective_from must be a timestamp or null'
  if (!isTimestampOrNull(rule.effective_to)) return 'effective_to must be a timestamp or null'
  if (rule.effective_from && rule.effective_to
    && new Date(rule.effective_to) <= new Date(rule.effective_from)) {
    return 'effective_to must be after effective_from'
  }
  if (!isStringArrayWithin(rule.required_audiences, PLAN_AUDIENCE_KEYS, { allowEmpty: true })) {
    return 'required_audiences must contain only known audiences'
  }
  if (!isStringArrayWithin(rule.billing_intervals, BILLING_INTERVALS, { allowEmpty: false })) {
    return 'billing_intervals must list at least one of month, year'
  }
  if (!Number.isInteger(rule.min_module_count) || rule.min_module_count < 1) {
    return 'min_module_count must be an integer of at least 1'
  }
  if (!Number.isInteger(rule.priority)) return 'priority must be an integer'
  return null
}

// Fills every column from the request body so validation doubles as the
// required-field check, exactly like createPlan's candidate object.
export function buildPricingRuleCandidate(body) {
  return {
    code: body.code,
    name: body.name,
    discount_type: body.discount_type,
    percent: body.percent ?? null,
    amount_cents: body.amount_cents ?? null,
    combinable: body.combinable ?? false,
    is_active: body.is_active ?? true,
    effective_from: body.effective_from ?? null,
    effective_to: body.effective_to ?? null,
    required_audiences: body.required_audiences ?? [],
    min_module_count: body.min_module_count ?? 1,
    billing_intervals: body.billing_intervals ?? [...BILLING_INTERVALS],
    priority: body.priority ?? 0,
  }
}
