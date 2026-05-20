import { describe, it, expect } from 'vitest'
import { computeInvoiceTotals as clientCompute } from '../utils/invoiceTotals.js'
import { computeInvoiceTotals as serverCompute } from '../../server/utils/computeInvoiceTotals.js'

const FIXTURES = [
  {
    name: 'exclusive VAT, single line',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 50000, tax_percentage: 9 }],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
    },
    expected: { subtotalCents: 50000, taxCents: 4500, totalCents: 54500 },
  },
  {
    name: 'inclusive VAT, single line',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 54500, tax_percentage: 9 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: false,
    },
    expected: { subtotalCents: 50000, taxCents: 4500, totalCents: 54500 },
  },
  {
    name: 'exclusive VAT, multi-line + quantity',
    input: {
      lines: [
        { quantity: 2, unit_price_cents: 12500, tax_percentage: 21 },
        { quantity: 1, unit_price_cents: 7500, tax_percentage: 9 },
      ],
      taxInclusive: false,
      discountCents: 0,
      appliesKor: false,
    },
    expected: { subtotalCents: 32500, taxCents: 5250 + 675, totalCents: 32500 + 5250 + 675 },
  },
  {
    name: 'exclusive VAT with discount',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
      taxInclusive: false,
      discountCents: 10000,
      appliesKor: false,
    },
    expected: { subtotalCents: 100000, taxCents: 21000, discountCents: 10000, totalCents: 111000 },
  },
  {
    name: 'applies KOR forces zero VAT regardless of tax_inclusive',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 50000, tax_percentage: 21 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: true,
    },
    expected: { subtotalCents: 50000, taxCents: 0, totalCents: 50000 },
  },
  {
    name: 'rounding edge: inclusive VAT with awkward gross',
    input: {
      lines: [{ quantity: 1, unit_price_cents: 12345, tax_percentage: 21 }],
      taxInclusive: true,
      discountCents: 0,
      appliesKor: false,
    },
    // net = round(12345*100/121) = 10202; tax = 12345 - 10202 = 2143
    expected: { subtotalCents: 10202, taxCents: 2143, totalCents: 12345 },
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
      expect(server).toEqual(client)
    })
  }
})
