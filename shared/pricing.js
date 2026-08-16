// The pricing engine: modules + pricing rules → a complete price snapshot.
//
// Pure by construction — no DB, no provider, no clock of its own. The server
// charges exactly what this returns and the billing page previews the same
// object, so any divergence here is a divergence between the quote and the
// invoice. Authored as plain `.js` like the rest of `shared/` because the
// server runs ESM with no build step.
//
// A snapshot is retained per subscription configuration so an existing price
// agreement stays reproducible after the catalogue moves on:
//
//   { modules:   { band: { plan: 'gold', priceCents: 2000 }, … },
//     subtotalCents: 3000,
//     discounts: [{ code, name, version, type, value, amountCents }],
//     totalCents: 2700 }
import { PLAN_AUDIENCE_KEYS } from './planAudiences.js'

export const BILLING_INTERVALS = Object.freeze(['month', 'year'])

export const DISCOUNT_TYPES = Object.freeze({ PERCENTAGE: 'percentage', FIXED: 'fixed' })

// Pricing semantics carried over from the plan catalog (migration 100):
// null = interval unavailable, 0 = free (fallback plans only), > 0 = paid cents.
// Owned here rather than in the billing slice so the frontend preview and the
// server charge read the same column for the same interval.
export function priceForInterval(plan, interval) {
  return interval === 'year' ? plan.yearly_price_cents : plan.monthly_price_cents
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ms(value) {
  return value === null || value === undefined ? null : new Date(value).getTime()
}

// Postgres NUMERIC arrives as a string through node-postgres, so a rule loaded
// from the DB and one built in a test must both work.
function toNumber(value) {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// The discount amount a rule takes off `subtotalCents`. Throws rather than
// silently pricing at zero: a rule whose value does not match its own
// `discount_type` is corrupt data, and quietly ignoring it would undercharge.
function discountAmountCents(rule, subtotalCents) {
  if (rule.discount_type === DISCOUNT_TYPES.PERCENTAGE) {
    const percent = toNumber(rule.percent)
    if (percent === null || percent <= 0) {
      throw new Error(`pricing rule ${rule.code} is a percentage rule without a valid percent`)
    }
    return Math.round((subtotalCents * percent) / 100)
  }
  if (rule.discount_type === DISCOUNT_TYPES.FIXED) {
    const amount = toNumber(rule.amount_cents)
    if (amount === null || amount <= 0) {
      throw new Error(`pricing rule ${rule.code} is a fixed rule without a valid amount_cents`)
    }
    // Clamped so one oversized rule cannot drive the total negative and make a
    // later rule's share of the subtotal meaningless.
    return Math.min(Math.round(amount), subtotalCents)
  }
  throw new Error(`pricing rule ${rule.code} has an unknown discount_type "${rule.discount_type}"`)
}

function ruleValue(rule) {
  return rule.discount_type === DISCOUNT_TYPES.PERCENTAGE
    ? toNumber(rule.percent)
    : toNumber(rule.amount_cents)
}

function isCandidate(rule, { audiences, interval, nowMs }) {
  if (!rule.is_active) return false

  const from = ms(rule.effective_from)
  const to = ms(rule.effective_to)
  // Half-open window: a rule is live from its start instant until its end
  // instant, so two consecutive promos never both apply on the boundary.
  if (from !== null && nowMs < from) return false
  if (to !== null && nowMs >= to) return false

  const intervals = rule.billing_intervals ?? BILLING_INTERVALS
  if (!intervals.includes(interval)) return false

  if (audiences.length < (rule.min_module_count ?? 1)) return false

  const required = rule.required_audiences ?? []
  return required.every((audience) => audiences.includes(audience))
}

// Deterministic order, and deterministic combination: the first candidate
// always applies, and each later one applies only if it AND every rule already
// applied is combinable. So a non-combinable rule is either the only discount
// or no discount at all.
function selectRules(rules, context) {
  const candidates = rules
    .filter((rule) => isCandidate(rule, context))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || String(a.code).localeCompare(String(b.code)))

  const selected = []
  for (const rule of candidates) {
    if (selected.length > 0 && (!rule.combinable || !selected.every((r) => r.combinable))) continue
    selected.push(rule)
  }
  return selected
}

// `modules` is [{ audience, plan }] where `plan` is a subscription_plans row.
// `rules` is the pricing_rules rows to consider — filtering happens here, so a
// caller may hand over the whole active catalog.
export function computePriceSnapshot({ modules, rules = [], interval, now = new Date() }) {
  if (!BILLING_INTERVALS.includes(interval)) {
    throw new Error(`unknown billing interval "${interval}"`)
  }

  const priced = {}
  let subtotalCents = 0
  for (const { audience, plan } of modules) {
    if (!PLAN_AUDIENCE_KEYS.includes(audience)) {
      throw new Error(`unknown module audience "${audience}"`)
    }
    if (audience in priced) {
      throw new Error(`duplicate module for audience "${audience}"`)
    }
    const priceCents = priceForInterval(plan, interval)
    if (priceCents === null || priceCents === undefined) {
      throw new Error(`plan ${plan.slug} is not priced for the ${interval} interval`)
    }
    priced[audience] = { plan: plan.slug, priceCents }
    subtotalCents += priceCents
  }

  const audiences = Object.keys(priced)
  const selected = selectRules(rules, { audiences, interval, nowMs: new Date(now).getTime() })

  // Every discount is measured against the ORIGINAL subtotal, never a running
  // total, so the amounts do not depend on the order rules happen to apply in.
  const discounts = selected.map((rule) => ({
    code: rule.code,
    // The display name travels with the snapshot. The code remains the stable
    // rule identity, but customers should see the human-readable name.
    ...(typeof rule.name === 'string' && rule.name.trim() ? { name: rule.name } : {}),
    version: rule.version,
    type: rule.discount_type,
    value: ruleValue(rule),
    amountCents: discountAmountCents(rule, subtotalCents),
  }))

  const discounted = discounts.reduce((sum, d) => sum + d.amountCents, 0)
  return {
    modules: priced,
    subtotalCents,
    discounts,
    totalCents: Math.max(0, subtotalCents - discounted),
  }
}

// The positive difference owed for the remainder of the current period when a
// module is added or upgraded mid-cycle. Never negative: a configuration that
// costs less takes effect at the next renewal instead of refunding here.
export function computeProrationCents({ oldTotalCents, newTotalCents, periodStart, periodEnd, now = new Date() }) {
  const startMs = new Date(periodStart).getTime()
  const endMs = new Date(periodEnd).getTime()
  const periodMs = endMs - startMs
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new Error('proration needs a period with a positive length')
  }

  const delta = newTotalCents - oldTotalCents
  if (delta <= 0) return 0

  const remainingMs = Math.max(0, endMs - new Date(now).getTime())
  return Math.round((delta * remainingMs) / periodMs)
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0
}

// Validates a stored snapshot the way validateEntitlements validates a stored
// entitlements object: complete, well-typed, and internally consistent.
// Returns an array of error strings — empty means valid.
export function validatePriceSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return ['price snapshot must be an object']

  const errors = []
  const { modules, discounts } = snapshot

  let moduleTotal = 0
  if (!isPlainObject(modules)) {
    errors.push('"modules" must be an object keyed by audience')
  } else {
    for (const [audience, entry] of Object.entries(modules)) {
      if (!PLAN_AUDIENCE_KEYS.includes(audience)) {
        errors.push(`unknown module audience "${audience}"`)
        continue
      }
      if (!isPlainObject(entry) || typeof entry.plan !== 'string' || !isNonNegativeInt(entry.priceCents)) {
        errors.push(`module "${audience}" must have a plan slug and a non-negative priceCents`)
        continue
      }
      moduleTotal += entry.priceCents
    }
  }

  let discountTotal = 0
  if (!Array.isArray(discounts)) {
    errors.push('"discounts" must be an array')
  } else {
    for (const d of discounts) {
      if (!isPlainObject(d) || typeof d.code !== 'string' || !Number.isInteger(d.version)
        || !Object.values(DISCOUNT_TYPES).includes(d.type)
        || typeof d.value !== 'number' || !isNonNegativeInt(d.amountCents)) {
        errors.push('each discount needs code, version, type, value and amountCents')
        continue
      }
      discountTotal += d.amountCents
    }
  }

  if (!isNonNegativeInt(snapshot.subtotalCents)) {
    errors.push('subtotalCents must be a non-negative integer')
  } else if (errors.length === 0 && snapshot.subtotalCents !== moduleTotal) {
    errors.push('subtotalCents must equal the sum of the module prices')
  }

  if (!isNonNegativeInt(snapshot.totalCents)) {
    errors.push('totalCents must be a non-negative integer')
  } else if (errors.length === 0 && snapshot.totalCents !== snapshot.subtotalCents - discountTotal) {
    errors.push('totalCents must equal subtotalCents minus the sum of the discounts')
  }

  return errors
}
