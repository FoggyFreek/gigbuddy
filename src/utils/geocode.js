import { lookupGeocode } from '../api/geocode.js'

// Browser-side cache and de-duplication for the gig world map. The actual
// provider lookup runs through /api/geocode so the server owns rate limiting,
// provider headers, and third-party data egress.

const GEOCODING_ENABLED = true

const STORE_KEY = 'gb.geocache.v1'
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // confirmed misses self-heal after a week

const norm = (v) => String(v ?? '').trim().toLowerCase()

function cacheKey(city, region, country) {
  return `${norm(city)}|${norm(region)}|${norm(country)}`
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // quota / unavailable storage - caching is best-effort
  }
}

// undefined = not cached (or expired) -> fetch; null = cached confirmed miss; object = hit.
function readCache(key) {
  const entry = loadStore()[key]
  if (!entry) return undefined
  if (entry.miss) {
    return Date.now() - entry.ts < MISS_TTL_MS ? null : undefined
  }
  return Number.isFinite(entry.lat) && Number.isFinite(entry.lon)
    ? { lat: entry.lat, lon: entry.lon }
    : undefined
}

function writeHit(key, coords) {
  const store = loadStore()
  store[key] = { lat: coords.lat, lon: coords.lon }
  saveStore(store)
}

function writeMiss(key) {
  const store = loadStore()
  store[key] = { miss: true, ts: Date.now() }
  saveStore(store)
}

async function fetchAndCache(key, place) {
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

const inflight = new Map()

/**
 * Resolve a place to { lat, lon }, or null if it can't be geocoded.
 * Requires `city`; `region` and `country` are optional refinements.
 */
export async function geocodePlace({ city, region, country } = {}) {
  if (!GEOCODING_ENABLED || !norm(city)) return null

  const key = cacheKey(city, region, country)
  const cached = readCache(key)
  if (cached !== undefined) return cached

  if (inflight.has(key)) return inflight.get(key)

  const promise = fetchAndCache(key, { city, region, country }).finally(() =>
    inflight.delete(key),
  )
  inflight.set(key, promise)
  return promise
}
