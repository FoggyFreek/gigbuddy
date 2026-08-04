import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/_client.ts', () => ({ request: vi.fn() }))

import { getPlaceDetails, searchPlaces } from '../api/places.ts'
import { request } from '../api/_client.ts'

beforeEach(() => {
  request.mockReset()
})

describe('searchPlaces', () => {
  it('forwards a known country and city so the provider can narrow the results', async () => {
    request.mockResolvedValue({ items: [] })

    await searchPlaces('Paradiso', { country: 'NL', city: 'Amsterdam' })

    const url = new URL(request.mock.calls[0][0], 'https://example.test')
    expect(url.searchParams.get('q')).toBe('Paradiso')
    expect(url.searchParams.get('country')).toBe('NL')
    expect(url.searchParams.get('city')).toBe('Amsterdam')
  })

  it('omits blank narrowing fields', async () => {
    request.mockResolvedValue({ items: [] })

    await searchPlaces('Paradiso', { country: '', city: null })

    const url = new URL(request.mock.calls[0][0], 'https://example.test')
    expect(url.searchParams.has('country')).toBe(false)
    expect(url.searchParams.has('city')).toBe(false)
  })
})

describe('getPlaceDetails', () => {
  it('preserves a more complete postal code from the Suggest subtitles', async () => {
    request.mockResolvedValue({
      id: 'poi-neushoorn',
      name: 'Neushoorn',
      street_and_number: 'Ruiterskwartier 41',
      postal_code: '8911',
      city: 'Leeuwarden',
      region: 'Friesland',
      country: 'NL',
      website: null,
      phone: null,
      latitude: 53.2003,
      longitude: 5.79024,
      freeform_address: 'Ruiterskwartier 41, 8911 BP Leeuwarden',
      categories: [],
      details: null,
    })
    const suggestion = {
      id: 'poi-neushoorn',
      name: 'Neushoorn',
      street_and_number: null,
      postal_code: null,
      city: null,
      region: null,
      country: null,
      website: null,
      phone: null,
      latitude: null,
      longitude: null,
      freeform_address: 'Ruiterskwartier 41, 8911 BP Leeuwarden',
      categories: [],
      details: {
        id: 'poi-neushoorn',
        session_id: '34a45e58-9f68-4ca6-bc0e-4f04311fbc42',
      },
    }

    const result = await getPlaceDetails(suggestion)

    expect(result.postal_code).toBe('8911 BP')
  })
})
