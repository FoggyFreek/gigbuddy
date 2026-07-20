import { describe, it, expect } from 'vitest'
import { computeInvoiceTotals as clientCompute } from '../utils/invoiceTotals.ts'
import { computeInvoiceTotals as serverCompute } from '../../server/utils/computeInvoiceTotals.js'

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
