import { describe, it, expect } from 'vitest'
import { computeInvoiceTotals as clientCompute, computeVatBreakdown } from '../invoiceTotals.ts'
import { computeInvoiceTotals as serverCompute } from '../../../../server/utils/computeInvoiceTotals.js'
import { VAT_RATE_VALUES } from '../../../../shared/vatRates.js'

const FIXTURES = [
  {
    name: 'exclusive VAT, single line, no discount',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 50000, tax_percentage: 9 }],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
    },
    expected: {
      subtotalCents: 50000,
      taxCents: 4500,
      totalCents: 54500,
      vatByRate: [{ rate: 9, cents: 4500 }],
    },
  },
  {
    name: 'inclusive VAT, single line, no discount',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 54500, tax_percentage: 9 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: false,
    },
    expected: {
      subtotalCents: 50000,
      taxCents: 4500,
      totalCents: 54500,
      vatByRate: [{ rate: 9, cents: 4500 }],
    },
  },
  {
    name: 'exclusive VAT, multi-rate lines, no discount',
    input: {
      lines: [
        { quantity: 2, unit_price_cents: 12500, tax_percentage: 21 },
        { quantity: 1, unit_price_cents: 7500, tax_percentage: 9 },
      ],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
    },
    expected: {
      subtotalCents: 32500,
      taxCents: 5925,
      totalCents: 38425,
      vatByRate: [
        { rate: 9, cents: 675 },
        { rate: 21, cents: 5250 },
      ],
    },
  },
  {
    name: 'absolute discount — no discountType (backward-compat)',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
      taxInclusive: false,
      discountCents: 10000,
      appliesKor: false,
    },
    // discountedSubtotal = 90000; VAT = round(90000 * 21 / 100) = 18900; total = 108900
    expected: {
      subtotalCents: 100000,
      taxCents: 18900,
      discountCents: 10000,
      totalCents: 108900,
      vatByRate: [{ rate: 21, cents: 18900 }],
    },
  },
  {
    name: 'absolute discount — eur type explicit',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 200000, tax_percentage: 9 }],
      taxInclusive: false,
      discountType: 'eur',
      discountPct: 0,
      discountCents: 20000,
      appliesKor: false,
    },
    // discountedSubtotal = 180000; VAT = round(180000 * 9 / 100) = 16200; total = 196200
    expected: {
      subtotalCents: 200000,
      taxCents: 16200,
      discountCents: 20000,
      totalCents: 196200,
      vatByRate: [{ rate: 9, cents: 16200 }],
    },
  },
  {
    name: 'percentage discount — 10% of subtotal',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 200000, tax_percentage: 9 }],
      taxInclusive: false,
      discountType: 'pct',
      discountPct: 10,
      discountCents: 0,
      appliesKor: false,
    },
    // discount = 20000; discountedSubtotal = 180000
    // 9% group: discountedGroupNet = 180000; VAT = round(180000 * 9 / 100) = 16200; total = 196200
    expected: {
      subtotalCents: 200000,
      taxCents: 16200,
      discountCents: 20000,
      totalCents: 196200,
      vatByRate: [{ rate: 9, cents: 16200 }],
    },
  },
  {
    name: 'percentage discount — fractional result rounded correctly',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 33333, tax_percentage: 9 }],
      taxInclusive: false,
      discountType: 'pct',
      discountPct: 10,
      discountCents: 0,
      appliesKor: false,
    },
    // discount = round(33333 * 10 / 100) = 3333
    // 9% group: discountedGroupNet = round(33333 * 30000 / 33333) = 30000
    // VAT = round(30000 * 9 / 100) = 2700; total = 32700
    expected: {
      subtotalCents: 33333,
      taxCents: 2700,
      discountCents: 3333,
      totalCents: 32700,
    },
  },
  {
    name: 'percentage discount capped at 100%',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 10000, tax_percentage: 9 }],
      taxInclusive: false,
      discountType: 'pct',
      discountPct: 150,
      discountCents: 0,
      appliesKor: false,
    },
    // discount capped at subtotal (10000); discountedSubtotal = 0; VAT = 0; total = 0
    expected: {
      subtotalCents: 10000,
      taxCents: 0,
      discountCents: 10000,
      totalCents: 0,
      vatByRate: [],
    },
  },
  {
    // Exact numbers from screenshot: TEST 1×€200@9%, TEST2 1×€100@21%, discount €100
    name: 'multi-rate with absolute discount — screenshot reference',
    input: {
      lines: [
        { quantity: 1, unit_price_cents: 20000, tax_percentage: 9 },
        { quantity: 1, unit_price_cents: 10000, tax_percentage: 21 },
      ],
      taxInclusive: false,
      discountType: 'eur',
      discountPct: 0,
      discountCents: 10000,
      appliesKor: false,
    },
    // subtotal = 30000; discount = 10000; discountedSubtotal = 20000
    // 9%  group: net=20000 → discountedGroupNet = round(20000*20000/30000) = 13333
    //            VAT = round(13333 * 9 / 100) = 1200
    // 21% group: net=10000 → discountedGroupNet = round(10000*20000/30000) = 6667
    //            VAT = round(6667 * 21 / 100) = 1400
    // total = 20000 + 1200 + 1400 = 22600
    expected: {
      subtotalCents: 30000,
      taxCents: 2600,
      discountCents: 10000,
      totalCents: 22600,
      vatByRate: [
        { rate: 9, cents: 1200 },
        { rate: 21, cents: 1400 },
      ],
    },
  },
  {
    name: 'applies KOR forces zero VAT regardless of tax_inclusive',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 50000, tax_percentage: 21 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: true,
    },
    expected: {
      subtotalCents: 50000,
      taxCents: 0,
      totalCents: 50000,
      vatByRate: [],
    },
  },
  {
    name: 'reverse charge forces zero VAT (customer accounts for VAT)',
    input: {
      lines: [{ quantity: 2, unit_price_cents: 30000, tax_percentage: 21 }],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
      reverseCharge: true,
    },
    expected: {
      subtotalCents: 60000,
      taxCents: 0,
      totalCents: 60000,
      vatByRate: [],
    },
  },
  {
    name: 'rounding edge: inclusive VAT with awkward gross, no discount',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 12345, tax_percentage: 21 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: false,
    },
    // net = round(12345*100/121) = 10202; tax = grossCents - netCents = 12345 - 10202 = 2143
    // (zero-discount path uses pre-computed tax to preserve gross = net + tax exactly)
    expected: {
      subtotalCents: 10202,
      taxCents: 2143,
      totalCents: 12345,
      vatByRate: [{ rate: 21, cents: 2143 }],
    },
  },
]

describe('invoice totals — server/client parity', () => {
  for (const { name, input, expected } of FIXTURES) {
    it(name, () => {
      const client = clientCompute(input)
      const server = serverCompute(input)
      expect(client.subtotalCents).toBe(expected.subtotalCents)
      expect(client.taxCents).toBe(expected.taxCents)
      expect(client.totalCents).toBe(expected.totalCents)
      if ('discountCents' in expected) {
        expect(client.discountCents).toBe(expected.discountCents)
      }
      if ('vatByRate' in expected) {
        expect(client.vatByRate).toEqual(expected.vatByRate)
      }
      expect(server).toEqual(client)
    })
  }
})

// The UBL/Peppol export needs a per-VAT-category view that computeInvoiceTotals
// cannot give it (vatByRate drops zero-cent groups, and the per-rate discount
// allocation is internal). computeVatBreakdown derives one, and must tie back to
// the authoritative totals EXACTLY — those are what is persisted and posted to
// the ledger, so any drift would put a different number in the XML than in the
// PDF and the journal.
const assertBreakdownIdentities = (input) => {
  const { totals, categories } = computeVatBreakdown(input)
  const sum = (fn) => categories.reduce((acc, c) => acc + fn(c), 0)

  expect(sum((c) => c.lineNetCents)).toBe(totals.subtotalCents)
  expect(sum((c) => c.allowanceCents)).toBe(totals.discountCents)
  expect(sum((c) => c.taxableCents)).toBe(totals.subtotalCents - totals.discountCents)
  expect(sum((c) => c.taxCents)).toBe(totals.taxCents)

  for (const c of categories) {
    expect(c.taxableCents + c.allowanceCents).toBe(c.lineNetCents)
    // BR-Z-09 / BR-E-09 / BR-AE-09: a zero-rated category carries no tax. This is
    // why the residual is never redistributed into an arbitrary "largest" group.
    if (c.percent === 0) expect(c.taxCents).toBe(0)
  }
  return { totals, categories }
}

describe('computeVatBreakdown — ties exactly to the authoritative totals', () => {
  for (const { name, input } of FIXTURES) {
    it(name, () => assertBreakdownIdentities(input))
  }

  it('emits one category per rate, sorted ascending, including zero-tax groups', () => {
    const { categories } = computeVatBreakdown({
      lines: [
        { quantity: 1, unit_price_cents: 10000, tax_percentage: 21 },
        { quantity: 1, unit_price_cents: 5000, tax_percentage: 0 },
      ],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
    })
    // vatByRate would have dropped the 0% group entirely; the breakdown keeps it.
    expect(categories).toEqual([
      { code: 'Z', percent: 0, lineNetCents: 5000, allowanceCents: 0, taxableCents: 5000, taxCents: 0 },
      { code: 'S', percent: 21, lineNetCents: 10000, allowanceCents: 0, taxableCents: 10000, taxCents: 2100 },
    ])
  })

  it('never moves tax into a zero-rated category when a discount forces a residual', () => {
    const { categories } = assertBreakdownIdentities({
      lines: [
        { quantity: 1, unit_price_cents: 10000, tax_percentage: 21 },
        { quantity: 1, unit_price_cents: 10000, tax_percentage: 0 },
      ],
      taxInclusive: false,
      discountType: 'eur',
      discountCents: 3333,
      appliesKor: false,
    })
    expect(categories.find((c) => c.percent === 0).taxCents).toBe(0)
  })

  it('splits a document discount across rate groups so each side reconciles', () => {
    // The screenshot reference fixture: 200@9% + 100@21%, €100 off.
    const { categories } = assertBreakdownIdentities(FIXTURES.find(
      (f) => f.name === 'multi-rate with absolute discount — screenshot reference',
    ).input)
    expect(categories).toEqual([
      { code: 'S', percent: 9, lineNetCents: 20000, allowanceCents: 6667, taxableCents: 13333, taxCents: 1200 },
      { code: 'S', percent: 21, lineNetCents: 10000, allowanceCents: 3333, taxableCents: 6667, taxCents: 1400 },
    ])
  })

  it('labels every category AE under reverse charge and E under KOR', () => {
    const lines = [
      { quantity: 1, unit_price_cents: 10000, tax_percentage: 21 },
      { quantity: 1, unit_price_cents: 5000, tax_percentage: 9 },
    ]
    const rc = computeVatBreakdown({ lines, taxInclusive: false, discountCents: 0, reverseCharge: true })
    expect(rc.categories.map((c) => c.code)).toEqual(['AE'])
    expect(rc.categories[0]).toMatchObject({ percent: 0, lineNetCents: 15000, taxCents: 0 })

    const kor = computeVatBreakdown({ lines, taxInclusive: false, discountCents: 0, appliesKor: true })
    expect(kor.categories.map((c) => c.code)).toEqual(['E'])
  })

  // Deterministic LCG rather than Math.random: a failure must be reproducible.
  const lcg = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

  it('holds the identities across 5000 generated invoices', () => {
    const rand = lcg(20260728)
    const pick = (arr) => arr[Math.floor(rand() * arr.length)]

    for (let i = 0; i < 5000; i++) {
      const rates = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(VAT_RATE_VALUES))
      const input = {
        lines: rates.map((rate) => ({
          quantity: 1 + Math.floor(rand() * 5),
          unit_price_cents: 1 + Math.floor(rand() * 500000),
          tax_percentage: rate,
        })),
        taxInclusive: rand() < 0.5,
        appliesKor: rand() < 0.15,
        reverseCharge: rand() < 0.15,
        ...(rand() < 0.5
          ? { discountType: 'pct', discountPct: Math.floor(rand() * 120), discountCents: 0 }
          : { discountType: 'eur', discountCents: Math.floor(rand() * 300000) }),
      }
      assertBreakdownIdentities(input)
    }
  })
})
