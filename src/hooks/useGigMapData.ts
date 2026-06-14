import { useEffect, useState } from 'react'
import { listGigs } from '../api/gigs.ts'
import { geocodePlace } from '../utils/geocode.ts'
import type { Gig } from '../types/entities.ts'

// DATE columns arrive as ISO strings or 'YYYY-MM-DD'; key by the first 10 chars
// (same convention as DashboardPage).
const dateKey = (v: string | Date | undefined): string => (v ? String(v).slice(0, 10) : '')

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const cityKey = (city: string, region: string, country: string): string =>
  `${city}|${region ?? ''}|${country ?? ''}`.toLowerCase()

function cityLabel(city: string, region: string, country: string): string {
  return [city, region, country].filter(Boolean).join(', ')
}

function coordinateKey(lat: number, lon: number): string {
  return `${Number(lat).toFixed(5)}|${Number(lon).toFixed(5)}`
}

interface GigSummary {
  id?: Gig['id']
  event_date?: Gig['event_date']
  event_description?: Gig['event_description']
}

interface CityGroup {
  key: string
  city: string
  region: string
  country: string
  label: string
  gigs: GigSummary[]
}

export interface MapMarker extends CityGroup {
  lat: number
  lon: number
  locationKey: string
}

export interface GigMapState {
  status: 'ok' | 'error'
  loading: boolean
  cityCount: number
  gigCount: number
  markers: MapMarker[]
}

function mergeMarkerByLocation(markers: MapMarker[], marker: MapMarker): MapMarker[] {
  const locationKey = coordinateKey(marker.lat, marker.lon)
  const existingIndex = markers.findIndex((m) => m.locationKey === locationKey)
  if (existingIndex === -1) return [...markers, { ...marker, locationKey }]

  return markers.map((m, index) => {
    if (index !== existingIndex) return m
    return {
      ...m,
      gigs: [...m.gigs, ...marker.gigs]
        .sort((a, b) => dateKey(b.event_date).localeCompare(dateKey(a.event_date))),
    }
  })
}

// Group past gigs by city (city|region|country), venue-first then festival. Gigs
// without a city can't be placed on the map and are skipped.
function buildCityGroups(gigs: Gig[], today: string): CityGroup[] {
  const groups = new Map<string, CityGroup>()
  for (const g of gigs) {
    if (dateKey(g.event_date) >= today) continue
    const place = g.venue ?? g.festival
    const city = place?.city
    if (!city) continue

    const region = place.region ?? ''
    const country = place.country ?? ''
    const key = cityKey(city, region, country)
    if (!groups.has(key)) {
      groups.set(key, { key, city, region, country, label: cityLabel(city, region, country), gigs: [] })
    }
    groups.get(key)!.gigs.push({
      id: g.id,
      event_date: g.event_date,
      event_description: g.event_description,
    })
  }
  for (const group of groups.values()) {
    group.gigs.sort((a, b) => dateKey(b.event_date).localeCompare(dateKey(a.event_date)))
  }
  return [...groups.values()]
}

const INITIAL: GigMapState = { status: 'ok', loading: true, cityCount: 0, gigCount: 0, markers: [] }

/**
 * Loads past gigs, groups them by city, and geocodes each city for the world map.
 * Geocoding happens progressively (pins appear as they resolve); cities that fail
 * to geocode are simply omitted and do not flip `status` to 'error' — only a failed
 * gig load does that, so the dashboard tile can show its error state.
 */
export function useGigMapData(): GigMapState {
  const [state, setState] = useState<GigMapState>(INITIAL)

  useEffect(() => {
    let cancelled = false

    async function run() {
      let gigs: Gig[]
      try {
        gigs = await listGigs()
      } catch {
        if (!cancelled) setState({ ...INITIAL, status: 'error', loading: false })
        return
      }

      const groups = buildCityGroups(gigs || [], todayStr())
      const gigCount = groups.reduce((n, group) => n + group.gigs.length, 0)
      if (cancelled) return
      setState({ status: 'ok', loading: true, cityCount: groups.length, gigCount, markers: [] })

      let markers: MapMarker[] = []
      for (const group of groups) {
        const coords = await geocodePlace({ city: group.city, region: group.region, country: group.country })
        if (cancelled) return
        if (coords) {
          markers = mergeMarkerByLocation(markers, { ...group, lat: coords.lat, lon: coords.lon, locationKey: coordinateKey(coords.lat, coords.lon) })
          setState((s) => ({ ...s, cityCount: markers.length, markers: [...markers] }))
        }
      }
      if (!cancelled) setState((s) => ({ ...s, cityCount: markers.length, loading: false }))
    }

    run()
    return () => { cancelled = true }
  }, [])

  return state
}
