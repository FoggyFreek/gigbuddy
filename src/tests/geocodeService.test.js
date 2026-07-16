// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { geocodePlace, geocodeVenue, resetGeocodeCacheForTests } from '../../server/services/geocodeService.js'

function hit(lat, lon) {
  return { ok: true, json: async () => [{ lat: String(lat), lon: String(lon) }] }
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  resetGeocodeCacheForTests()
})

afterEach(() => {
  resetGeocodeCacheForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('server geocode service', () => {
  it('persists a provider hit on the tenant-scoped venue record', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: 7,
          city: 'Amsterdam',
          region: '',
          country: 'NL',
          latitude: null,
          longitude: null,
        }] })
        .mockResolvedValueOnce({ rows: [{ latitude: 52.37, longitude: 4.9 }] }),
    }
    const fetchImpl = vi.fn(async () => hit(52.37, 4.9))

    const result = await geocodeVenue(db, 3, 7, { fetchImpl })

    expect(result).toEqual({ status: 'hit', coords: { lat: 52.37, lon: 4.9 } })
    expect(db.query).toHaveBeenCalledTimes(2)
    expect(db.query.mock.calls[1][1]).toEqual([52.37, 4.9, 7, 3])
  })

  it('returns stored venue coordinates without calling the provider', async () => {
    const db = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{
        id: 7,
        city: 'Amsterdam',
        region: '',
        country: 'NL',
        latitude: 52.37,
        longitude: 4.9,
      }] }),
    }
    const fetchImpl = vi.fn()

    await expect(geocodeVenue(db, 3, 7, { fetchImpl })).resolves.toEqual({
      status: 'hit', coords: { lat: 52.37, lon: 4.9 },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('uses the server provider lookup and caches hits', async () => {
    const fetchImpl = vi.fn(async () => hit(52.37, 4.9))

    const first = await geocodePlace(
      { city: 'Amsterdam', region: '', country: 'NL' },
      { fetchImpl },
    )
    expect(first).toEqual({ status: 'hit', coords: { lat: 52.37, lon: 4.9 } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/gigbuddy/i)

    const second = await geocodePlace(
      { city: 'Amsterdam', region: '', country: 'NL' },
      { fetchImpl },
    )
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('adds street and postalcode to the structured query and free-form q when given an address', async () => {
    const fetchImpl = vi.fn(async () => hit(52.09, 5.12))

    await geocodePlace(
      { city: 'Utrecht', country: 'NL', address: 'Domplein 1', postalCode: '3512 JC' },
      { fetchImpl },
    )

    // A single structured hit means only one call; inspect its URL.
    const url = new URL(fetchImpl.mock.calls[0][0])
    expect(url.searchParams.get('street')).toBe('Domplein 1')
    expect(url.searchParams.get('postalcode')).toBe('3512 JC')
    expect(url.searchParams.get('city')).toBe('Utrecht')
  })

  it('keys the cache by address so street-level and city-level lookups do not collide', async () => {
    const fetchImpl = vi.fn(async () => hit(1, 2))

    // City-level first (runs immediately), then the same city with a street:
    // distinct keys → two calls. The second waits out the 1s provider gap.
    await geocodePlace({ city: 'Utrecht', country: 'NL' }, { fetchImpl })
    const second = geocodePlace({ city: 'Utrecht', country: 'NL', address: 'Domplein 1' }, { fetchImpl })
    await vi.advanceTimersByTimeAsync(1000)
    await second
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Repeating the city-level lookup reuses the original three-part key: served
    // from cache, so no new provider call (and no queue wait).
    await geocodePlace({ city: 'Utrecht', country: 'NL' }, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('queues distinct provider calls at least one second apart', async () => {
    const fetchImpl = vi.fn(async () => hit(1, 2))

    const first = geocodePlace({ city: 'A', region: '', country: 'NL' }, { fetchImpl })
    await expect(first).resolves.toEqual({ status: 'hit', coords: { lat: 1, lon: 2 } })

    const second = geocodePlace({ city: 'B', region: '', country: 'NL' }, { fetchImpl })
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(second).resolves.toEqual({ status: 'hit', coords: { lat: 1, lon: 2 } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
