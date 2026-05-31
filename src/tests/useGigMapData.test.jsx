import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.js', () => ({ listGigs: vi.fn() }))
vi.mock('../utils/geocode.js', () => ({ geocodePlace: vi.fn() }))

import { listGigs } from '../api/gigs.js'
import { geocodePlace } from '../utils/geocode.js'
import { useGigMapData } from '../hooks/useGigMapData.js'

// "today" fixed at 2026-05-30; venue/festival arrive as nested objects with city.
beforeEach(() => {
  vi.setSystemTime(new Date('2026-05-30T12:00:00Z'))
  geocodePlace.mockImplementation(async ({ city, region }) => ({
    lat: `${city}${region ?? ''}`.length,
    lon: 0,
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useGigMapData', () => {
  it('keeps only past gigs, prefers venue over festival, drops city-less gigs, and groups by city', async () => {
    listGigs.mockResolvedValue([
      { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { city: 'Utrecht', region: 'UT', country: 'NL' }, festival: null },
      { id: 2, event_date: '2026-02-10', event_description: 'B', venue: { city: 'Utrecht', region: 'UT', country: 'NL' }, festival: null },
      { id: 3, event_date: '2026-12-31', event_description: 'Future', venue: { city: 'Berlin', country: 'DE' }, festival: null },
      { id: 4, event_date: '2026-03-01', event_description: 'C', venue: null, festival: { city: 'Rotterdam', country: 'NL' } },
      { id: 5, event_date: '2026-03-02', event_description: 'NoCity', venue: { name: 'X' }, festival: null },
    ])

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.status).toBe('ok')
    expect(result.current.cityCount).toBe(2) // Utrecht, Rotterdam (Berlin is future, NoCity dropped)
    expect(result.current.gigCount).toBe(3) // 2 in Utrecht + 1 in Rotterdam
    expect(result.current.markers).toHaveLength(2)

    const utrecht = result.current.markers.find((m) => m.city === 'Utrecht')
    expect(utrecht.gigs.map((g) => g.id)).toEqual([2, 1]) // newest first
    expect(utrecht).toHaveProperty('lat')
    expect(utrecht).toHaveProperty('lon')
  })

  it('keeps same-named cities in different regions as separate markers', async () => {
    listGigs.mockResolvedValue([
      { id: 1, event_date: '2026-01-10', event_description: 'IL show', venue: { city: 'Springfield', region: 'IL', country: 'US' }, festival: null },
      { id: 2, event_date: '2026-01-11', event_description: 'MA show', venue: { city: 'Springfield', region: 'MA', country: 'US' }, festival: null },
    ])

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.cityCount).toBe(2)
    expect(result.current.markers).toHaveLength(2)
  })

  it('drops cities that fail to geocode without erroring', async () => {
    listGigs.mockResolvedValue([
      { id: 1, event_date: '2026-01-10', event_description: 'A', venue: { city: 'Utrecht', country: 'NL' }, festival: null },
      { id: 2, event_date: '2026-01-11', event_description: 'B', venue: { city: 'Atlantis', country: 'NL' }, festival: null },
    ])
    geocodePlace.mockImplementation(async ({ city }) =>
      city === 'Atlantis' ? null : { lat: 1, lon: 2 },
    )

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.status).toBe('ok')
    expect(result.current.markers).toHaveLength(1)
    expect(result.current.markers[0].city).toBe('Utrecht')
  })

  it('reports an error status when listing gigs fails', async () => {
    listGigs.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useGigMapData())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.loading).toBe(false)
    expect(result.current.markers).toHaveLength(0)
  })
})
