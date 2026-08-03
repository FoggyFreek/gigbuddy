import { describe, it, expect } from 'vitest'
import { PLACE_FILLABLE_FIELDS, pickFillableUpdates } from '../utils/placeFill.ts'

const SUGGESTION = {
  name: 'Paradiso',
  street_and_number: 'Weteringschans 6',
  postal_code: '1017SG',
  city: 'Amsterdam',
  region: 'Noord-Holland',
  country: 'NL',
  website: 'https://www.paradiso.nl',
  phone: '+31 20 626 4521',
  latitude: 52.3624,
  longitude: 4.8838,
}

describe('pickFillableUpdates', () => {
  it('fills every blank field from the suggestion', () => {
    expect(pickFillableUpdates({}, SUGGESTION)).toEqual({
      street_and_number: 'Weteringschans 6',
      postal_code: '1017SG',
      city: 'Amsterdam',
      region: 'Noord-Holland',
      country: 'NL',
      website: 'https://www.paradiso.nl',
      phone: '+31 20 626 4521',
    })
  })

  it('never overwrites a field that already has a value', () => {
    const current = { city: 'Utrecht', phone: '030 1234567' }
    const updates = pickFillableUpdates(current, SUGGESTION)
    expect(updates).not.toHaveProperty('city')
    expect(updates).not.toHaveProperty('phone')
    expect(updates.postal_code).toBe('1017SG')
  })

  it('treats whitespace-only and null as blank', () => {
    const updates = pickFillableUpdates({ city: '   ', region: null, country: undefined }, SUGGESTION)
    expect(updates.city).toBe('Amsterdam')
    expect(updates.region).toBe('Noord-Holland')
    expect(updates.country).toBe('NL')
  })

  it('skips fields the suggestion has no value for', () => {
    const sparse = { city: 'Amsterdam', phone: null, website: '  ' }
    expect(pickFillableUpdates({}, sparse)).toEqual({ city: 'Amsterdam' })
  })

  it('never contributes coordinates or the name', () => {
    const updates = pickFillableUpdates({}, SUGGESTION)
    expect(updates).not.toHaveProperty('latitude')
    expect(updates).not.toHaveProperty('longitude')
    expect(updates).not.toHaveProperty('name')
  })

  it('trims the incoming values', () => {
    expect(pickFillableUpdates({}, { city: '  Amsterdam  ' })).toEqual({ city: 'Amsterdam' })
  })

  it('returns an empty object for a missing suggestion', () => {
    expect(pickFillableUpdates({ city: '' }, null)).toEqual({})
  })

  it('honours a caller-supplied field subset', () => {
    expect(pickFillableUpdates({}, SUGGESTION, ['city', 'country'])).toEqual({
      city: 'Amsterdam',
      country: 'NL',
    })
  })

  it('exposes the fillable fields without coordinates', () => {
    expect(PLACE_FILLABLE_FIELDS).not.toContain('latitude')
    expect(PLACE_FILLABLE_FIELDS).not.toContain('name')
  })
})
