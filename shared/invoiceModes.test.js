import { describe, expect, it } from 'vitest'
import { resolveEffectiveMode } from './invoiceModes.js'

describe('resolveEffectiveMode', () => {
  it('uses specified when a booking fee has a basis', () => {
    expect(resolveEffectiveMode({ agency_fee_basis: 'percentage' }, 'specified')).toBe('specified')
  })

  it('collapses specified without a booking fee to combined', () => {
    expect(resolveEffectiveMode({ agency_fee_basis: 'none' }, 'specified')).toBe('combined')
  })

  it('treats unknown preferences as combined', () => {
    expect(resolveEffectiveMode({ agency_fee_basis: 'amount' }, 'split')).toBe('combined')
  })
})
