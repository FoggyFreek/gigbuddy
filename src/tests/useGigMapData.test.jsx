import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({ listGigMapData: vi.fn() }))
vi.mock('../api/me.ts', () => ({ listMyGigMapData: vi.fn() }))
vi.mock('../api/geocode.ts', () => ({ lookupVenueGeocode: vi.fn(), lookupGeocode: vi.fn() }))
vi.mock('../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))

import { listGigMapData } from '../api/gigs.ts'
import { listMyGigMapData } from '../api/me.ts'
import { lookupGeocode, lookupVenueGeocode } from '../api/geocode.ts'
import { useAuth } from '../contexts/authContext.ts'
import { useGigMapData } from '../hooks/useGigMapData.ts'

// "today" fixed at 2026-05-30; venue/festival arrive as nested objects with city.
beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(new Date('2026-05-30T12:00:00Z'))
  useAuth.mockReturnValue({ user: { id: 1, activeTenantKind: 'band' } })
  lookupVenueGeocode.mockImplementation(async (id) => ({
    status: 'hit',
    coords: { lat: Number(id), lon: 0 },
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useGigMapData', () => {
  it('fetches the complete past window, prefers venue over festival, drops city-less gigs, and groups by city', async () => {
    listGigMapData.mockResolvedValue({ items: [
      { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 11, city: 'Utrecht', region: 'UT', country: 'NL' }, festival: null },
      { id: 2, event_date: '2026-02-10', event_description: 'B', venue: { id: 11, city: 'Utrecht', region: 'UT', country: 'NL' }, festival: null },
      { id: 3, event_date: '2026-03-01', event_description: 'C', venue: null, festival: { id: 12, city: 'Rotterdam', country: 'NL' } },
      { id: 4, event_date: '2026-03-02', event_description: 'NoCity', venue: { id: 13 }, festival: null },
      { id: 5, event_date: '2026-03-03', event_description: 'Festival fallback', venue: { id: 14 }, festival: { id: 15, city: 'Eindhoven', country: 'NL' } },
    ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 5 } })

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(listGigMapData).toHaveBeenCalledWith({ from: '0001-01-01', to: '2026-05-29' })
    expect(result.current.status).toBe('ok')
    expect(result.current.cityCount).toBe(3)
    expect(result.current.gigCount).toBe(4) // 2 in Utrecht + Rotterdam + festival fallback
    expect(result.current.markers).toHaveLength(3)

    const utrecht = result.current.markers.find((m) => m.city === 'Utrecht')
    expect(utrecht.gigs.map((g) => g.id)).toEqual([2, 1]) // newest first
    expect(utrecht).toHaveProperty('lat')
    expect(utrecht).toHaveProperty('lon')
  })

  it('keeps same-named cities in different regions as separate markers', async () => {
    listGigMapData.mockResolvedValue({ items: [
      { id: 1, event_date: '2026-01-10', event_description: 'IL show', venue: { id: 1, city: 'Springfield', region: 'IL', country: 'US' }, festival: null },
      { id: 2, event_date: '2026-01-11', event_description: 'MA show', venue: { id: 2, city: 'Springfield', region: 'MA', country: 'US' }, festival: null },
    ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 2 } })

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.cityCount).toBe(2)
    expect(result.current.markers).toHaveLength(2)
  })

  it('coalesces groups that geocode to the same location into one marker with the combined gig count', async () => {
    listGigMapData.mockResolvedValue({ items: [
      { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 1, city: 'Groningen', region: '', country: 'NL' }, festival: null },
      { id: 2, event_date: '2026-02-10', event_description: 'B', venue: { id: 2, city: 'Groningen', region: 'GR', country: 'NL' }, festival: null },
      { id: 3, event_date: '2026-03-10', event_description: 'C', venue: { id: 3, city: 'Groningen', region: '', country: 'Netherlands' }, festival: null },
    ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 3 } })
    lookupVenueGeocode.mockResolvedValue({ status: 'hit', coords: { lat: 53.2194, lon: 6.5665 } })

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.cityCount).toBe(1)
    expect(result.current.gigCount).toBe(3)
    expect(result.current.markers).toHaveLength(1)
    expect(result.current.markers[0].gigs.map((g) => g.id)).toEqual([3, 2, 1])
  })

  it('uses stored coordinates without calling the geocode API and only requests missing coordinates', async () => {
    listGigMapData.mockResolvedValue({ items: [
      { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 21, city: 'Utrecht', country: 'NL', latitude: 52.09, longitude: 5.12 }, festival: null },
      { id: 2, event_date: '2026-01-11', event_description: 'B', venue: { id: 22, city: 'Rotterdam', country: 'NL', latitude: null, longitude: null }, festival: null },
    ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 2 } })
    lookupVenueGeocode.mockResolvedValue({ status: 'hit', coords: { lat: 51.92, lon: 4.48 } })

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.status).toBe('ok')
    expect(result.current.markers).toHaveLength(2)
    expect(lookupVenueGeocode).toHaveBeenCalledTimes(1)
    expect(lookupVenueGeocode).toHaveBeenCalledWith(22)
    expect(result.current.markers.find((marker) => marker.city === 'Utrecht')).toMatchObject({ lat: 52.09, lon: 5.12 })
  })

  it('reports an error status when listing gigs fails', async () => {
    listGigMapData.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.loading).toBe(false)
    expect(result.current.markers).toHaveLength(0)
  })

  // In an artist workspace the map spans every band the musician played in.
  describe('in an artist workspace', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({ user: { id: 1, activeTenantKind: 'personal' } })
    })

    it('reads the cross-band projection instead of the active tenant\'s', async () => {
      listMyGigMapData.mockResolvedValue({ items: [
        { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 11, city: 'Utrecht', country: 'NL', latitude: 52.09, longitude: 5.12 }, festival: null, tenantId: 9, tenantName: 'The Nightowls' },
      ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 1 } })

      const { result } = renderHook(() => useGigMapData())
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(listMyGigMapData).toHaveBeenCalledWith({ from: '0001-01-01', to: '2026-05-29' })
      expect(listGigMapData).not.toHaveBeenCalled()
      expect(result.current.markers).toHaveLength(1)
    })

    // /geocode/venue/:id is scoped to the active tenant and persists what it
    // finds — neither is valid for a venue owned by another band.
    it('geocodes the city rather than another band\'s venue row', async () => {
      listMyGigMapData.mockResolvedValue({ items: [
        { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 22, city: 'Rotterdam', region: 'ZH', country: 'NL', latitude: null, longitude: null }, festival: null, tenantId: 9 },
      ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 1 } })
      lookupGeocode.mockResolvedValue({ status: 'hit', coords: { lat: 51.92, lon: 4.48 } })

      const { result } = renderHook(() => useGigMapData())
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(lookupGeocode).toHaveBeenCalledWith({ city: 'Rotterdam', region: 'ZH', country: 'NL' })
      expect(lookupVenueGeocode).not.toHaveBeenCalled()
      expect(result.current.markers[0]).toMatchObject({ lat: 51.92, lon: 4.48 })
    })

    it('still prefers stored coordinates, geocoding nothing', async () => {
      listMyGigMapData.mockResolvedValue({ items: [
        { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { id: 21, city: 'Utrecht', country: 'NL', latitude: 52.09, longitude: 5.12 }, festival: null, tenantId: 9 },
      ], meta: { from: '0001-01-01', to: '2026-05-29', returned: 1 } })

      const { result } = renderHook(() => useGigMapData())
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(lookupGeocode).not.toHaveBeenCalled()
      expect(lookupVenueGeocode).not.toHaveBeenCalled()
      expect(result.current.markers[0]).toMatchObject({ lat: 52.09, lon: 5.12 })
    })
  })
})
