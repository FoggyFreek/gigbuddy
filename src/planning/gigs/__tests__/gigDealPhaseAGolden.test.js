import { describe, expect, it } from 'vitest'
import golden from './fixtures/gigDealPhaseA.golden.json'
import { buildGigDealGoldenCases } from './gigDealGoldenCases.js'

describe('gig deal Phase A behavior golden', () => {
  it('preserves every legacy statement, simulation and invoice-line result byte-for-byte', () => {
    expect(JSON.stringify(buildGigDealGoldenCases())).toBe(JSON.stringify(golden))
  })
})
