import { lookupGeocode } from '../api/geocode.ts'

// Browser-side cache and de-duplication for the gig world map. The actual
// provider lookup runs through /api/geocode so the server owns rate limiting,
// provider headers, and third-party data egress.

const GEOCODING_ENABLED = true

const STORE_KEY = 'gb.geocache.v1'
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // confirmed misses self-heal after a week

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase()

interface GeoPlace {
  city?: string
  region?: string
  country?: string
  address?: string
  postalCode?: string
}

function cacheKey({ city, region, country, address, postalCode }: GeoPlace): string {
  const base = `${norm(city)}|${norm(region)}|${norm(country)}`
  // Keep the original three-part key when no refinement is present so existing
  // city-level cache entries (gb.geocache.v1) stay reusable; widen only for
  // street/postal precision. Mirrors the server key rule.
  if (!norm(address) && !norm(postalCode)) return base
  return `${base}|${norm(postalCode)}|${norm(address)}`
}

interface CacheCoords {
  lat: number
  lon: number
}

interface CacheEntry {
  lat?: number
  lon?: number
  miss?: boolean
  ts?: number
}

type GeoStore = Record<string, CacheEntry>

function loadStore(): GeoStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as GeoStore) : {}
  } catch {
    return {}
  }
}

function saveStore(store: GeoStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // quota / unavailable storage - caching is best-effort
  }
}

// undefined = not cached (or expired) -> fetch; null = cached confirmed miss; object = hit.
function readCache(key: string): CacheCoords | null | undefined {
  const entry = loadStore()[key]
  if (!entry) return undefined
  if (entry.miss) {
    return Date.now() - (entry.ts ?? 0) < MISS_TTL_MS ? null : undefined
  }
  return Number.isFinite(entry.lat) && Number.isFinite(entry.lon)
    ? { lat: entry.lat as number, lon: entry.lon as number }
    : undefined
}

function writeHit(key: string, coords: CacheCoords): void {
  const store = loadStore()
  store[key] = { lat: coords.lat, lon: coords.lon }
  saveStore(store)
}

function writeMiss(key: string): void {
  const store = loadStore()
  store[key] = { miss: true, ts: Date.now() }
  saveStore(store)
}

async function fetchAndCache(key: string, place: { city: string; region?: string; country?: string; address?: string; postalCode?: string }): Promise<CacheCoords | null> {
  try {
    const result = await lookupGeocode(place)
    if (result?.status === 'hit' && result.coords) {
      writeHit(key, result.coords)
      return result.coords
    }
    if (result?.status === 'empty') writeMiss(key)
    return null
  } catch {
    return null
  }
}

const inflight = new Map<string, Promise<CacheCoords | null>>()

/**
 * Resolve a place to { lat, lon }, or null if it can't be geocoded.
 * Requires `city`; `region`, `country`, `address` (street), and `postalCode`
 * are optional refinements — `address`/`postalCode` sharpen to street level.
 */
export async function geocodePlace({ city, region, country, address, postalCode }: GeoPlace = {}): Promise<CacheCoords | null> {
  if (!GEOCODING_ENABLED || !norm(city)) return null

  const key = cacheKey({ city, region, country, address, postalCode })
  const cached = readCache(key)
  if (cached !== undefined) return cached

  if (inflight.has(key)) return inflight.get(key) as Promise<CacheCoords | null>

  const promise = fetchAndCache(key, { city: city ?? '', region, country, address, postalCode }).finally(() =>
    inflight.delete(key),
  )
  inflight.set(key, promise)
  return promise
}
