import { describe, expect, it } from 'vitest'
import {
  computePriceSnapshot,
  computeProrationCents,
  priceForInterval,
  validatePriceSnapshot,
} from '../../../../shared/pricing.js'

// The pricing engine is pure and shared: the server charges what it returns and
// the billing page previews the same object, so a divergence here is a
// divergence between the quote and the invoice.

const GOLD = { id: 3, slug: 'gold', monthly_price_cents: 2000, yearly_price_cents: 20000 }
const ARTIST_GOLD = { id: 5, slug: 'artist_gold', monthly_price_cents: 1000, yearly_price_cents: 10000 }
const SILVER = { id: 2, slug: 'silver', monthly_price_cents: 1200, yearly_price_cents: null }

const NOW = new Date('2027-04-15T12:00:00Z')

function rule(overrides = {}) {
  return {
    code: 'dual_module_bundle',
    name: 'Two-module bundle',
    version: 1,
    discount_type: 'percentage',
    percent: '10.00',
    amount_cents: null,
    combinable: false,
    is_active: true,
    effective_from: null,
    effective_to: null,
    required_audiences: [],
    min_module_count: 1,
    billing_intervals: ['month', 'year'],
    priority: 0,
    ...overrides,
  }
}

const bandOnly = [{ audience: 'band', plan: GOLD }]
const both = [{ audience: 'band', plan: GOLD }, { audience: 'artist', plan: ARTIST_GOLD }]

describe('priceForInterval', () => {
  it('selects the column matching the interval', () => {
    expect(priceForInterval(GOLD, 'month')).toBe(2000)
    expect(priceForInterval(GOLD, 'year')).toBe(20000)
  })

  it('returns null when the interval is unavailable', () => {
    expect(priceForInterval(SILVER, 'year')).toBeNull()
  })
})

describe('computePriceSnapshot — modules and subtotal', () => {
  it('prices a single module with no rules', () => {
    const snap = computePriceSnapshot({ modules: bandOnly, rules: [], interval: 'month', now: NOW })
    expect(snap).toEqual({
      modules: { band: { plan: 'gold', priceCents: 2000 } },
      subtotalCents: 2000,
      discounts: [],
      totalCents: 2000,
    })
  })

  it('sums both modules', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [], interval: 'month', now: NOW })
    expect(snap.modules).toEqual({
      band: { plan: 'gold', priceCents: 2000 },
      artist: { plan: 'artist_gold', priceCents: 1000 },
    })
    expect(snap.subtotalCents).toBe(3000)
    expect(snap.totalCents).toBe(3000)
  })

  it('uses the yearly price for a yearly interval', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [], interval: 'year', now: NOW })
    expect(snap.subtotalCents).toBe(30000)
  })

  it('throws when a module plan is not priced for the interval', () => {
    expect(() => computePriceSnapshot({
      modules: [{ audience: 'band', plan: SILVER }], rules: [], interval: 'year', now: NOW,
    })).toThrow(/not priced/i)
  })

  it('throws on a duplicate audience', () => {
    expect(() => computePriceSnapshot({
      modules: [{ audience: 'band', plan: GOLD }, { audience: 'band', plan: SILVER }],
      rules: [], interval: 'month', now: NOW,
    })).toThrow(/duplicate/i)
  })

  it('throws on an unknown interval', () => {
    expect(() => computePriceSnapshot({
      modules: bandOnly, rules: [], interval: 'week', now: NOW,
    })).toThrow(/interval/i)
  })
})

describe('computePriceSnapshot — the spec example', () => {
  it('reproduces the documented dual-module snapshot', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [rule({ min_module_count: 2 })], interval: 'month', now: NOW })
    expect(snap).toEqual({
      modules: {
        band: { plan: 'gold', priceCents: 2000 },
        artist: { plan: 'artist_gold', priceCents: 1000 },
      },
      subtotalCents: 3000,
      discounts: [{ code: 'dual_module_bundle', name: 'Two-module bundle', version: 1, type: 'percentage', value: 10, amountCents: 300 }],
      totalCents: 2700,
    })
  })
})

describe('computePriceSnapshot — rule eligibility', () => {
  it('skips a rule below its minimum module count', () => {
    const snap = computePriceSnapshot({ modules: bandOnly, rules: [rule({ min_module_count: 2 })], interval: 'month', now: NOW })
    expect(snap.discounts).toEqual([])
    expect(snap.totalCents).toBe(2000)
  })

  it('skips a rule whose required audiences are not all present', () => {
    const r = rule({ required_audiences: ['band', 'artist'] })
    expect(computePriceSnapshot({ modules: bandOnly, rules: [r], interval: 'month', now: NOW }).discounts).toEqual([])
    expect(computePriceSnapshot({ modules: both, rules: [r], interval: 'month', now: NOW }).discounts).toHaveLength(1)
  })

  it('skips an inactive rule', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [rule({ is_active: false })], interval: 'month', now: NOW })
    expect(snap.discounts).toEqual([])
  })

  it('honours the effective window, inclusive of the start and exclusive of the end', () => {
    const window = { effective_from: '2027-04-01T00:00:00Z', effective_to: '2027-05-01T00:00:00Z' }
    const r = rule(window)
    const at = (iso) => computePriceSnapshot({ modules: both, rules: [r], interval: 'month', now: new Date(iso) }).discounts

    expect(at('2027-03-31T23:59:59Z')).toEqual([])
    expect(at('2027-04-01T00:00:00Z')).toHaveLength(1)
    expect(at('2027-04-30T23:59:59Z')).toHaveLength(1)
    expect(at('2027-05-01T00:00:00Z')).toEqual([])
  })

  it('skips a rule that does not cover the billing interval', () => {
    const snap = computePriceSnapshot({
      modules: both, rules: [rule({ billing_intervals: ['year'] })], interval: 'month', now: NOW,
    })
    expect(snap.discounts).toEqual([])
  })
})

describe('computePriceSnapshot — combination', () => {
  const a = rule({ code: 'a', priority: 1, percent: '10.00', combinable: true })
  const b = rule({ code: 'b', priority: 2, percent: '5.00', combinable: true })

  it('stacks combinable rules', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [a, b], interval: 'month', now: NOW })
    expect(snap.discounts.map((d) => d.code)).toEqual(['a', 'b'])
    expect(snap.discounts.map((d) => d.amountCents)).toEqual([300, 150])
    expect(snap.totalCents).toBe(2550)
  })

  it('applies a non-combinable rule alone', () => {
    const snap = computePriceSnapshot({
      modules: both, rules: [{ ...a, combinable: false }, b], interval: 'month', now: NOW,
    })
    expect(snap.discounts.map((d) => d.code)).toEqual(['a'])
    expect(snap.totalCents).toBe(2700)
  })

  it('refuses a non-combinable rule once another has applied', () => {
    const snap = computePriceSnapshot({
      modules: both, rules: [a, { ...b, combinable: false }], interval: 'month', now: NOW,
    })
    expect(snap.discounts.map((d) => d.code)).toEqual(['a'])
  })

  it('orders by priority, then code, so the result is deterministic', () => {
    const forward = computePriceSnapshot({ modules: both, rules: [a, b], interval: 'month', now: NOW })
    const reversed = computePriceSnapshot({ modules: both, rules: [b, a], interval: 'month', now: NOW })
    expect(reversed).toEqual(forward)

    const tie = computePriceSnapshot({
      modules: both,
      rules: [{ ...b, priority: 1 }, { ...a, code: 'aa' }],
      interval: 'month',
      now: NOW,
    })
    expect(tie.discounts.map((d) => d.code)).toEqual(['aa', 'b'])
  })

  it('computes every discount against the original subtotal, not a running total', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [a, b], interval: 'month', now: NOW })
    // 5% of 3000 is 150; 5% of the already-discounted 2700 would be 135.
    expect(snap.discounts[1].amountCents).toBe(150)
  })
})

describe('computePriceSnapshot — amounts', () => {
  it('subtracts a fixed discount in cents', () => {
    const snap = computePriceSnapshot({
      modules: both,
      rules: [rule({ discount_type: 'fixed', percent: null, amount_cents: 450 })],
      interval: 'month',
      now: NOW,
    })
    expect(snap.discounts[0]).toEqual({
      code: 'dual_module_bundle', name: 'Two-module bundle', version: 1, type: 'fixed', value: 450, amountCents: 450,
    })
    expect(snap.totalCents).toBe(2550)
  })

  it('clamps a fixed discount to the subtotal and floors the total at zero', () => {
    const snap = computePriceSnapshot({
      modules: bandOnly,
      rules: [rule({ discount_type: 'fixed', percent: null, amount_cents: 999999 })],
      interval: 'month',
      now: NOW,
    })
    expect(snap.discounts[0].amountCents).toBe(2000)
    expect(snap.totalCents).toBe(0)
  })

  it('rounds a fractional percentage to the nearest cent', () => {
    const snap = computePriceSnapshot({
      modules: bandOnly, rules: [rule({ percent: '12.34' })], interval: 'month', now: NOW,
    })
    // 2000 * 12.34% = 246.8
    expect(snap.discounts[0].amountCents).toBe(247)
    expect(snap.totalCents).toBe(1753)
  })

  it('accepts a numeric percent as well as the string Postgres returns', () => {
    const asString = computePriceSnapshot({ modules: bandOnly, rules: [rule({ percent: '10.00' })], interval: 'month', now: NOW })
    const asNumber = computePriceSnapshot({ modules: bandOnly, rules: [rule({ percent: 10 })], interval: 'month', now: NOW })
    expect(asNumber).toEqual(asString)
    expect(asNumber.discounts[0].value).toBe(10)
  })

  it('rejects a rule whose value does not match its type', () => {
    expect(() => computePriceSnapshot({
      modules: bandOnly, rules: [rule({ percent: null })], interval: 'month', now: NOW,
    })).toThrow(/percent/i)
    expect(() => computePriceSnapshot({
      modules: bandOnly, rules: [rule({ discount_type: 'fixed', percent: null, amount_cents: null })],
      interval: 'month', now: NOW,
    })).toThrow(/amount/i)
  })
})

describe('computeProrationCents', () => {
  const periodStart = new Date('2027-04-01T00:00:00Z')
  const periodEnd = new Date('2027-05-01T00:00:00Z')

  it('charges the difference in proportion to the time remaining', () => {
    const now = new Date('2027-04-16T00:00:00Z') // exactly half
    expect(computeProrationCents({ oldTotalCents: 2000, newTotalCents: 3000, periodStart, periodEnd, now })).toBe(500)
  })

  it('charges the full difference at the very start of the period', () => {
    expect(computeProrationCents({
      oldTotalCents: 2000, newTotalCents: 3000, periodStart, periodEnd, now: periodStart,
    })).toBe(1000)
  })

  it('charges nothing once the period has ended', () => {
    expect(computeProrationCents({
      oldTotalCents: 2000, newTotalCents: 3000, periodStart, periodEnd, now: new Date('2027-05-02T00:00:00Z'),
    })).toBe(0)
  })

  it('never charges for a non-positive difference', () => {
    const now = new Date('2027-04-16T00:00:00Z')
    expect(computeProrationCents({ oldTotalCents: 3000, newTotalCents: 2000, periodStart, periodEnd, now })).toBe(0)
    expect(computeProrationCents({ oldTotalCents: 3000, newTotalCents: 3000, periodStart, periodEnd, now })).toBe(0)
  })

  it('rounds to whole cents', () => {
    const now = new Date('2027-04-11T00:00:00Z') // 20 of 30 days remain
    // 1000 * 20/30 = 666.67
    expect(computeProrationCents({ oldTotalCents: 2000, newTotalCents: 3000, periodStart, periodEnd, now })).toBe(667)
  })

  it('throws on a non-positive period rather than inventing a number', () => {
    expect(() => computeProrationCents({
      oldTotalCents: 0, newTotalCents: 1000, periodStart: periodEnd, periodEnd, now: periodEnd,
    })).toThrow(/period/i)
  })
})

describe('validatePriceSnapshot', () => {
  const valid = {
    modules: { band: { plan: 'gold', priceCents: 2000 } },
    subtotalCents: 2000,
    discounts: [{ code: 'x', name: 'Example discount', version: 1, type: 'percentage', value: 10, amountCents: 200 }],
    totalCents: 1800,
  }

  it('accepts a well-formed snapshot', () => {
    expect(validatePriceSnapshot(valid)).toEqual([])
  })

  it('accepts what the engine produces', () => {
    const snap = computePriceSnapshot({ modules: both, rules: [rule({ min_module_count: 2 })], interval: 'month', now: NOW })
    expect(validatePriceSnapshot(snap)).toEqual([])
  })

  it('rejects a total that does not tie back to the lines', () => {
    expect(validatePriceSnapshot({ ...valid, totalCents: 1700 })).toContain(
      'totalCents must equal subtotalCents minus the sum of the discounts',
    )
  })

  it('rejects a subtotal that does not tie back to the modules', () => {
    expect(validatePriceSnapshot({ ...valid, subtotalCents: 2500 }).join(' ')).toMatch(/subtotalCents/)
  })

  it('rejects unknown module keys and malformed shapes', () => {
    expect(validatePriceSnapshot(null)).toHaveLength(1)
    expect(validatePriceSnapshot({ ...valid, modules: { nope: { plan: 'x', priceCents: 1 } } }).join(' '))
      .toMatch(/nope/)
  })
})
