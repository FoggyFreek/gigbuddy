import { describe, it, expect } from 'vitest'
import { venueHeadline, venueCity, venueOptionLabel } from '../utils/venueDisplay.js'

describe('venueHeadline', () => {
  it('returns empty string for null', () => {
    expect(venueHeadline(null)).toBe('')
  })

  it('returns name for venue', () => {
    expect(venueHeadline({ category: 'venue', name: 'Café De Zwaan' })).toBe('Café De Zwaan')
  })

  it('returns name for festival (no festival_name field)', () => {
    expect(venueHeadline({ category: 'festival', name: 'Texel Blues Festival' })).toBe('Texel Blues Festival')
  })

  it('returns name for festival even when legacy festival_name is present', () => {
    expect(venueHeadline({ category: 'festival', name: 'Texel Blues Festival', festival_name: 'Old Value' })).toBe('Texel Blues Festival')
  })
})

describe('venueCity', () => {
  it('returns empty string for null', () => {
    expect(venueCity(null)).toBe('')
  })

  it('returns city', () => {
    expect(venueCity({ city: 'Den Hoorn' })).toBe('Den Hoorn')
  })
})

describe('venueOptionLabel', () => {
  it('returns headline alone when no city', () => {
    expect(venueOptionLabel({ category: 'festival', name: 'Big Fest' })).toBe('Big Fest')
  })

  it('appends city when present', () => {
    expect(venueOptionLabel({ category: 'festival', name: 'Big Fest', city: 'Rotterdam' })).toBe('Big Fest — Rotterdam')
  })
})
