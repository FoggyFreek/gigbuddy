import { useEffect, useState } from 'react'
import { listGigMapData } from '../api/gigs.ts'
import { lookupVenueGeocode } from '../api/geocode.ts'
import type { GigMapGig, GigMapPlace } from '../types/api.ts'

const MAP_HISTORY_START = '0001-01-01'

const dateKey = (value: string | Date | undefined): string =>
  value ? String(value).slice(0, 10) : ''

function localDateStr(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

function yesterdayStr(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return localDateStr(yesterday)
}

const cityKey = (city: string, region: string, country: string): string =>
  `${city}|${region}|${country}`.toLowerCase()

function cityLabel(city: string, region: string, country: string): string {
  return [city, region, country].filter(Boolean).join(', ')
}

function coordinateKey(lat: number, lon: number): string {
  return `${Number(lat).toFixed(5)}|${Number(lon).toFixed(5)}`
}

interface GigSummary {
  id: GigMapGig['id']
  event_date: GigMapGig['event_date']
  event_description: GigMapGig['event_description']
}

interface CityGroup {
  key: string
  city: string
  region: string
  country: string
  label: string
  gigs: GigSummary[]
  places: GigMapPlace[]
}

export interface MapMarker extends Omit<CityGroup, 'places'> {
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
  const existingIndex = markers.findIndex((item) => item.locationKey === locationKey)
  if (existingIndex === -1) return [...markers, { ...marker, locationKey }]

  return markers.map((item, index) => {
    if (index !== existingIndex) return item
    return {
      ...item,
      gigs: [...item.gigs, ...marker.gigs]
        .sort((a, b) => dateKey(b.event_date).localeCompare(dateKey(a.event_date))),
    }
  })
}

function addPlace(group: CityGroup, place: GigMapPlace): void {
  if (!group.places.some((item) => String(item.id) === String(place.id))) {
    group.places.push(place)
  }
}

function buildCityGroups(gigs: GigMapGig[]): CityGroup[] {
  const groups = new Map<string, CityGroup>()
  for (const gig of gigs) {
    const place = gig.venue?.city?.trim() ? gig.venue : gig.festival
    const city = place?.city?.trim()
    if (!place || !city) continue

    const region = place.region?.trim() ?? ''
    const country = place.country?.trim() ?? ''
    const key = cityKey(city, region, country)
    const group = groups.get(key) ?? {
      key,
      city,
      region,
      country,
      label: cityLabel(city, region, country),
      gigs: [],
      places: [],
    }
    group.gigs.push({
      id: gig.id,
      event_date: gig.event_date,
      event_description: gig.event_description,
    })
    addPlace(group, place)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.gigs.sort((a, b) => dateKey(b.event_date).localeCompare(dateKey(a.event_date)))
  }
  return [...groups.values()]
}

function storedCoordinates(place: GigMapPlace): { lat: number; lon: number } | null {
  if (place.latitude === null || place.latitude === undefined
    || place.longitude === null || place.longitude === undefined) return null
  const lat = Number(place.latitude)
  const lon = Number(place.longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
}

async function resolveGroupCoordinates(group: CityGroup): Promise<{ lat: number; lon: number } | null> {
  let coordinates = group.places.map(storedCoordinates).find(Boolean) ?? null

  // Persist every missing place once. The server-side provider cache prevents
  // duplicate external lookups when multiple venues share a city.
  for (const place of group.places) {
    if (storedCoordinates(place)) continue
    try {
      const result = await lookupVenueGeocode(place.id)
      if (result.status === 'hit' && result.coords) coordinates ??= result.coords
    } catch {
      // One unresolvable venue should not fail the rest of the map.
    }
  }
  return coordinates
}

const INITIAL: GigMapState = { status: 'ok', loading: true, cityCount: 0, gigCount: 0, markers: [] }

/** Loads the minimal past-gig projection and progressively resolves its city markers. */
export function useGigMapData(): GigMapState {
  const [state, setState] = useState<GigMapState>(INITIAL)

  useEffect(() => {
    let cancelled = false

    async function run() {
      let gigs: GigMapGig[]
      try {
        const response = await listGigMapData({ from: MAP_HISTORY_START, to: yesterdayStr() })
        gigs = response.items
      } catch {
        if (!cancelled) setState({ ...INITIAL, status: 'error', loading: false })
        return
      }

      const groups = buildCityGroups(gigs)
      const gigCount = groups.reduce((count, group) => count + group.gigs.length, 0)
      if (cancelled) return
      setState({ status: 'ok', loading: true, cityCount: groups.length, gigCount, markers: [] })

      let markers: MapMarker[] = []
      for (const group of groups) {
        const coords = await resolveGroupCoordinates(group)
        if (cancelled) return
        if (coords) {
          const { places: _places, ...markerGroup } = group
          markers = mergeMarkerByLocation(markers, {
            ...markerGroup,
            lat: coords.lat,
            lon: coords.lon,
            locationKey: coordinateKey(coords.lat, coords.lon),
          })
          setState((current) => ({ ...current, cityCount: markers.length, markers: [...markers] }))
        }
      }
      if (!cancelled) setState((current) => ({ ...current, cityCount: markers.length, loading: false }))
    }

    run()
    return () => { cancelled = true }
  }, [])

  return state
}
