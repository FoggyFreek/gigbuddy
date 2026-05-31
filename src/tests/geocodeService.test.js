// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { geocodePlace, resetGeocodeCacheForTests } from '../../server/services/geocodeService.js'

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
