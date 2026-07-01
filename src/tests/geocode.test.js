import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../api/geocode.ts', () => ({ lookupGeocode: vi.fn() }))

import { lookupGeocode } from '../api/geocode.ts'
import { geocodePlace } from '../utils/geocode.ts'

const hit = (lat, lon) => ({ status: 'hit', coords: { lat, lon } })
const empty = () => ({ status: 'empty' })
const fail = () => ({ status: 'fail' })

beforeEach(() => {
  localStorage.clear()
  lookupGeocode.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('geocodePlace', () => {
  it('returns null without fetching when city is missing', async () => {
    const result = await geocodePlace({ city: '', region: '', country: 'NL' })
    expect(result).toBeNull()
    expect(lookupGeocode).not.toHaveBeenCalled()
  })

  it('geocodes a city and caches the hit (no refetch on the second call)', async () => {
    lookupGeocode.mockResolvedValue(hit(52.37, 4.9))

    const first = await geocodePlace({ city: 'Amsterdam', region: '', country: 'NL' })
    expect(first).toEqual({ lat: 52.37, lon: 4.9 })
    expect(lookupGeocode).toHaveBeenCalledTimes(1)

    const second = await geocodePlace({ city: 'Amsterdam', region: '', country: 'NL' })
    expect(second).toEqual({ lat: 52.37, lon: 4.9 })
    expect(lookupGeocode).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by region so same-named cities do not collide', async () => {
    lookupGeocode.mockResolvedValue(hit(1, 2))

    await geocodePlace({ city: 'Springfield', region: 'IL', country: 'US' })
    await geocodePlace({ city: 'Springfield', region: 'MA', country: 'US' })

    expect(lookupGeocode).toHaveBeenCalledTimes(2)
  })

  it('caches confirmed misses returned by the server', async () => {
    lookupGeocode.mockResolvedValue(empty())

    const first = await geocodePlace({ city: 'Nowhere', region: '', country: 'XX' })
    expect(first).toBeNull()
    expect(lookupGeocode).toHaveBeenCalledTimes(1)

    const second = await geocodePlace({ city: 'Nowhere', region: '', country: 'XX' })
    expect(second).toBeNull()
    expect(lookupGeocode).toHaveBeenCalledTimes(1)
  })

  it('does not cache server failures (later call retries)', async () => {
    lookupGeocode.mockResolvedValueOnce(fail())

    const first = await geocodePlace({ city: 'Flaky', region: '', country: 'NL' })
    expect(first).toBeNull()

    lookupGeocode.mockResolvedValue(hit(7, 8))
    const second = await geocodePlace({ city: 'Flaky', region: '', country: 'NL' })
    expect(second).toEqual({ lat: 7, lon: 8 })
  })

  it('returns null on an API error without caching it', async () => {
    lookupGeocode.mockRejectedValueOnce(new Error('offline'))

    const first = await geocodePlace({ city: 'Edge', region: '', country: 'NL' })
    expect(first).toBeNull()

    lookupGeocode.mockResolvedValue(hit(9, 10))
    const second = await geocodePlace({ city: 'Edge', region: '', country: 'NL' })
    expect(second).toEqual({ lat: 9, lon: 10 })
  })

  it('geocodes a city-only place without throwing', async () => {
    lookupGeocode.mockResolvedValue(hit(48.85, 2.35))
    const result = await geocodePlace({ city: 'Paris' })
    expect(result).toEqual({ lat: 48.85, lon: 2.35 })
  })

  it('forwards address/postalCode and keys them separately from a city-only lookup', async () => {
    lookupGeocode.mockResolvedValue(hit(52.09, 5.12))

    await geocodePlace({ city: 'Utrecht', country: 'NL' })
    await geocodePlace({ city: 'Utrecht', country: 'NL', address: 'Domplein 1', postalCode: '3512 JC' })

    // Distinct keys → two lookups; the second carries the refinement fields.
    expect(lookupGeocode).toHaveBeenCalledTimes(2)
    expect(lookupGeocode).toHaveBeenLastCalledWith(
      expect.objectContaining({ city: 'Utrecht', address: 'Domplein 1', postalCode: '3512 JC' }),
    )

    // The city-only key is unchanged, so repeating it is served from cache.
    await geocodePlace({ city: 'Utrecht', country: 'NL' })
    expect(lookupGeocode).toHaveBeenCalledTimes(2)
  })
})
