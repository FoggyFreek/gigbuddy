import { describe, it, expect } from 'vitest'
import {
  formatGigCity,
  formatGigVenue,
  formatGigVenueName,
} from '../utils/shareCard.js'

const makeGig = ({ venue = null, festival = null } = {}) => ({
  event_date: '2026-07-04',
  event_description: 'Test Show',
  venue,
  festival,
})

const venueRow = { id: 1, category: 'venue', name: 'Café De Zwaan', city: 'Den Burg', festival_name: null }
const festivalRow = { id: 2, category: 'festival', name: 'Texel Blues', festival_name: 'Texel Blues Festival', city: 'Den Hoorn' }

describe('formatGigCity', () => {
  it('returns empty string when no venue and no festival', () => {
    expect(formatGigCity(makeGig())).toBe('')
  })

  it('returns venue city when only venue is set', () => {
    expect(formatGigCity(makeGig({ venue: venueRow }))).toBe('Den Burg')
  })

  it('returns festival city when only festival is set', () => {
    expect(formatGigCity(makeGig({ festival: festivalRow }))).toBe('Den Hoorn')
  })

  it('returns festival city (not venue city) when both are set', () => {
    expect(formatGigCity(makeGig({ venue: venueRow, festival: festivalRow }))).toBe('Den Hoorn')
  })
})

describe('formatGigVenueName', () => {
  it('returns empty string when no venue and no festival', () => {
    expect(formatGigVenueName(makeGig())).toBe('')
  })

  it('returns venue name when only venue is set', () => {
    expect(formatGigVenueName(makeGig({ venue: venueRow }))).toBe('Café De Zwaan')
  })

  it('returns festival headline when only festival is set', () => {
    // venueHeadline uses festival_name when category='festival'
    expect(formatGigVenueName(makeGig({ festival: festivalRow }))).toBe('Texel Blues Festival')
  })

  it('returns physical venue name (not festival) when both are set', () => {
    expect(formatGigVenueName(makeGig({ venue: venueRow, festival: festivalRow }))).toBe('Café De Zwaan')
  })
})

describe('formatGigVenue', () => {
  it('returns empty string when no venue and no festival', () => {
    expect(formatGigVenue(makeGig())).toBe('')
  })

  it('shows venue headline and city when venue is set', () => {
    expect(formatGigVenue(makeGig({ venue: venueRow }))).toBe('Café De Zwaan, Den Burg')
  })

  it('shows festival headline and city as fallback when only festival is set', () => {
    expect(formatGigVenue(makeGig({ festival: festivalRow }))).toBe('Texel Blues Festival, Den Hoorn')
  })

  it('shows physical venue info (not festival) when both are set', () => {
    expect(formatGigVenue(makeGig({ venue: venueRow, festival: festivalRow }))).toBe('Café De Zwaan, Den Burg')
  })
})
