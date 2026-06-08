import { describe, expect, it } from 'vitest'
import { computePurchaseLineTotals, computePurchaseTotals } from '../utils/purchaseTotals.js'

describe('computePurchaseLineTotals', () => {
  it('derives net and VAT from an inclusive amount at 21%', () => {
    const t = computePurchaseLineTotals({ amount_incl_cents: 125000, tax_rate: 21 })
    expect(t).toEqual({ netCents: 103306, vatCents: 21694, grossCents: 125000 })
  })

  it('derives net and VAT at 9%', () => {
    const t = computePurchaseLineTotals({ amount_incl_cents: 109000, tax_rate: 9 })
    expect(t).toEqual({ netCents: 100000, vatCents: 9000, grossCents: 109000 })
  })

  it('treats 0% as no VAT', () => {
    const t = computePurchaseLineTotals({ amount_incl_cents: 5000, tax_rate: 0 })
    expect(t).toEqual({ netCents: 5000, vatCents: 0, grossCents: 5000 })
  })
})

describe('computePurchaseTotals', () => {
  it('sums lines across rates', () => {
    const totals = computePurchaseTotals({
      lines: [
        { amount_incl_cents: 125000, tax_rate: 21 },
        { amount_incl_cents: 109000, tax_rate: 9 },
        { amount_incl_cents: 5000, tax_rate: 0 },
      ],
    })
    expect(totals.totalCents).toBe(239000)
    expect(totals.subtotalCents).toBe(103306 + 100000 + 5000)
    expect(totals.taxCents).toBe(21694 + 9000)
    expect(totals.vatByRate).toEqual([
      { rate: 9, cents: 9000 },
      { rate: 21, cents: 21694 },
    ])
  })

  it('handles an empty line list', () => {
    const totals = computePurchaseTotals({ lines: [] })
    expect(totals).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0, vatByRate: [] })
  })
})
