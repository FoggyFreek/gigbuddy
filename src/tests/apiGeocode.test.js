import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/_client.ts', () => ({ request: vi.fn(() => Promise.resolve({ status: 'empty' })) }))

import { request } from '../api/_client.ts'
import { lookupGeocode } from '../api/geocode.ts'

function calledPath() {
  return request.mock.calls[0][0]
}

beforeEach(() => {
  request.mockClear()
})

describe('lookupGeocode query serialization', () => {
  it('sends only city when region/country/address/postalCode are absent', () => {
    lookupGeocode({ city: 'Utrecht' })
    const url = new URL(calledPath(), 'http://x')
    expect(url.searchParams.get('city')).toBe('Utrecht')
    expect(url.searchParams.has('region')).toBe(false)
    expect(url.searchParams.has('address')).toBe(false)
    expect(url.searchParams.has('postalCode')).toBe(false)
  })

  it('includes address and postalCode when provided', () => {
    lookupGeocode({ city: 'Utrecht', region: 'UT', country: 'NL', address: 'Domplein 1', postalCode: '3512 JC' })
    const url = new URL(calledPath(), 'http://x')
    expect(url.searchParams.get('city')).toBe('Utrecht')
    expect(url.searchParams.get('region')).toBe('UT')
    expect(url.searchParams.get('country')).toBe('NL')
    expect(url.searchParams.get('address')).toBe('Domplein 1')
    expect(url.searchParams.get('postalCode')).toBe('3512 JC')
  })
})
