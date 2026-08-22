import { describe, expect, it } from 'vitest'
import { patchForGigField } from '../components/gigdetails/gigFormFields.ts'

describe('patchForGigField', () => {
  it('serializes money, counts, and nullable percentages without involving the detail page', () => {
    expect(patchForGigField('venue_costs', '800.50')).toEqual({ venue_costs_cents: 80050 })
    expect(patchForGigField('venue_capacity', '300')).toEqual({ venue_capacity: 300 })
    expect(patchForGigField('ticket_vat_percentage', '9.5')).toEqual({ ticket_vat_percentage: 9.5 })
  })

  it('keeps nullable blanks distinct from required fee and percentage blanks', () => {
    expect(patchForGigField('tickets_sold', '')).toEqual({ tickets_sold: null })
    expect(patchForGigField('ticket_vat_percentage', '')).toEqual({ ticket_vat_percentage: null })
    expect(patchForGigField('agency_fee_amount', '')).toEqual({ agency_fee_amount_cents: 0 })
    expect(patchForGigField('commission_percentage', '')).toEqual({ commission_percentage: 0 })
  })
})
