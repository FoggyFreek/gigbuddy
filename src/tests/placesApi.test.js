import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/_client.ts', () => ({ request: vi.fn() }))

import { getPlaceDetails } from '../api/places.ts'
import { request } from '../api/_client.ts'

beforeEach(() => {
  request.mockReset()
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
