// Generic place lookup backed by the TomTom Search API. Entity-agnostic on
// purpose: it returns a normalized suggestion shape keyed on the app's own field
// names, so any resource (venues today, contacts/suppliers later) can consume it
// without knowing anything about TomTom. Structured like geocodeService.js — the
// other outbound third-party lookup — with an injectable `fetchImpl` for tests.
//
// We use POI Search (/poiSearch), NOT the Autocomplete service: autocomplete only
// returns query-completion segments (brand/category/plaintext) with no address,
// phone, website or coordinates, so it cannot populate a single field.
import { logger } from '../utils/logger.js'
import { parsePlaceQuery } from '../validators/placeValidators.js'
import { badRequest } from './serviceErrors.js'

const API_BASE = 'https://api.tomtom.com/search/2/poiSearch'
const API_KEY = process.env.TOMTOM_API_KEY || ''
const REQUEST_TIMEOUT_MS = 5000

const NOT_CONFIGURED = {
  error: { status: 400, body: { error: 'Place search is not configured' } },
}
const UPSTREAM_FAILED = {
  error: { status: 502, body: { error: 'Place search request failed' } },
}

// Shorter than the geocoder's 7 days: TomTom is a metered upstream, so caching is
// about collapsing the keystroke burst behind one query, not long-term storage.
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

const cache = new Map()
const inflight = new Map()

function readCache(key) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts >= CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function writeCache(key, value) {
  // Bounded FIFO — search keys are unbounded (every prefix a user types), so an
  // unevicted Map would grow for the lifetime of the process.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { ts: Date.now(), value })
}

const text = (value) => {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

// TomTom returns bare hosts ("www.paradiso.nl"). normalizeOptionalUrl (applied
// downstream when the venue is written) rejects scheme-less values, so give every
// url an explicit scheme here.
function toWebsite(value) {
  const raw = text(value)
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function toStreetAndNumber(address = {}) {
  const street = text(address.streetName)
  const number = text(address.streetNumber)
  if (!street) return number
  return number ? `${street} ${number}` : street
}

function toCoordinate(value, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null
  return parsed
}

// Pure TomTom result -> app suggestion mapping. The single owner of the field
// mapping; exported so it can be unit-tested without touching the network.
export function mapPoiResult(result = {}) {
  const address = result.address ?? {}
  const poi = result.poi ?? {}
  const latitude = toCoordinate(result.position?.lat, -90, 90)
  const longitude = toCoordinate(result.position?.lon, -180, 180)
  const pairedCoords = latitude !== null && longitude !== null

  return {
    id: text(result.id),
    name: text(poi.name) ?? text(address.freeformAddress),
    street_and_number: toStreetAndNumber(address),
    postal_code: text(address.postalCode),
    city: text(address.municipality),
    region: text(address.countrySubdivision),
    country: text(address.countryCode)?.slice(0, 2).toUpperCase() ?? null,
    website: toWebsite(poi.url),
    phone: text(poi.phone),
    latitude: pairedCoords ? latitude : null,
    longitude: pairedCoords ? longitude : null,
    // Display only — never persisted.
    freeform_address: text(address.freeformAddress),
    categories: Array.isArray(poi.categories) ? poi.categories.filter((c) => typeof c === 'string') : [],
  }
}

function buildUrl({ query, limit, language, lat, lon }) {
  const params = new URLSearchParams({
    key: API_KEY,
    typeahead: 'true',
    limit: String(limit),
  })
  if (language) params.set('language', language)
  // lat/lon is TomTom's only soft bias. We deliberately do NOT send countrySet:
  // that is a hard restriction and would make foreign venues unfindable, and
  // bands tour abroad.
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
    params.set('lat', String(lat))
    params.set('lon', String(lon))
  }
  return `${API_BASE}/${encodeURIComponent(query)}.json?${params}`
}

const norm = (v) => String(v ?? '').trim().toLowerCase()

function cacheKey({ query, limit, language, lat, lon }) {
  return [norm(query), limit, norm(language), lat ?? '', lon ?? ''].join('|')
}

async function requestPlaces(url, limit, fetchImpl) {
  let res
  try {
    // Without a deadline a stalled upstream would pin both the Express request
    // and this query's inflight cache entry open indefinitely.
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn('placeSearch.request_failed', { err })
    return UPSTREAM_FAILED
  }
  if (!res.ok) {
    logger.warn('placeSearch.request_failed', { status: res.status })
    return UPSTREAM_FAILED
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    logger.warn('placeSearch.request_failed', { err })
    return UPSTREAM_FAILED
  }
  const results = Array.isArray(json?.results) ? json.results : []
  const items = results.map(mapPoiResult).filter((item) => item.name)
  // Bounded-collection envelope: meta echoes the scope actually applied.
  return { items, meta: { limit, returned: items.length } }
}

// Validates at the service boundary so a direct caller cannot build a malformed
// upstream request. Returns the bounded `{ items, meta }` envelope, or the
// `{ error }` service contract. Never throws on a network fault — a dead upstream
// must not 500 the SPA.
export async function searchPlaces(query = {}, { fetchImpl = globalThis.fetch } = {}) {
  const parsed = parsePlaceQuery(query)
  if (parsed.error) return badRequest(parsed.error)
  if (!API_KEY) return NOT_CONFIGURED
  if (typeof fetchImpl !== 'function') return UPSTREAM_FAILED

  const params = parsed.params
  const key = cacheKey(params)
  const cached = readCache(key)
  if (cached !== undefined) return cached

  const pending = inflight.get(key)
  if (pending) return pending

  const promise = requestPlaces(buildUrl(params), params.limit, fetchImpl)
    .then((result) => {
      // Only successful lookups are cached; a transient 502 must be retryable.
      if (!result.error) writeCache(key, result)
      return result
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, promise)
  return promise
}

export function isPlaceSearchConfigured() {
  return Boolean(API_KEY)
}

export function resetPlaceSearchCacheForTests() {
  cache.clear()
  inflight.clear()
}
