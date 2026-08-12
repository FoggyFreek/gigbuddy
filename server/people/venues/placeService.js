// Generic place lookup backed by TomTom Places Search API v3. Suggest stays
// lightweight while the user types; Details is called only for the selected
// result so the app can fill coordinates and contact fields without multiplying
// metered requests for every suggestion.
import { logger } from '../../utils/logger.js'
import {
  LATITUDE_MAX, LATITUDE_MIN, LONGITUDE_MAX, LONGITUDE_MIN, coordinateOrNull,
} from '../../utils/coordinates.js'
import { parsePlaceDetailsParams, parsePlaceQuery } from './placeValidators.js'
import { badRequest } from '../../platform/http/serviceErrors.js'

const API_BASE = 'https://api.tomtom.com/maps/orbis/places'
const SUGGEST_URL = `${API_BASE}/suggest`
const API_KEY = process.env.TOMTOM_API_KEY || ''
const API_VERSION = '3'
const SUGGEST_ATTRIBUTES = 'results(id,type,title,subtitles,address,poiTypes,more)'
const DETAILS_ATTRIBUTES = 'id,type,title,subtitles,position,address,contacts,poiTypes'
const REQUEST_TIMEOUT_MS = 5000

const NOT_CONFIGURED = {
  error: { status: 400, body: { error: 'Place search is not configured' } },
}
const UPSTREAM_FAILED = {
  error: { status: 502, body: { error: 'Place search request failed' } },
}

// Short-lived and bounded: this mainly collapses repeated debounced queries in
// one provider session while keeping the metered upstream protected.
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

function toWebsite(value) {
  const raw = text(value)
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function toStreetAndNumber(address = {}) {
  const street = text(address.street)
  const number = text(address.houseNumber)
  if (!street) return number
  return number ? `${street} ${number}` : street
}

function subtitles(result = {}) {
  if (!Array.isArray(result.subtitles)) return null
  const values = result.subtitles.map(text).filter(Boolean)
  return values.length ? values.join(', ') : null
}

function categories(result = {}) {
  if (!Array.isArray(result.poiTypes)) return []
  return result.poiTypes.map((category) => text(category?.name) ?? text(category?.id)).filter(Boolean)
}

function detailArgument(result, parameter) {
  if (result?.more?.operation !== 'details' || !Array.isArray(result.more.pathParameters)) return null
  return text(result.more.pathParameters.find((item) => item?.parameter === parameter)?.argument)
}

function firstContactValue(result, field) {
  if (!Array.isArray(result.contacts)) return null
  for (const contact of result.contacts) {
    if (!Array.isArray(contact?.[field])) continue
    const value = contact[field].map(text).find(Boolean)
    if (value) return value
  }
  return null
}

function basePlace(result = {}) {
  return {
    id: text(result.id),
    name: text(result.title),
    street_and_number: null,
    postal_code: null,
    city: null,
    region: null,
    country: null,
    website: null,
    phone: null,
    latitude: null,
    longitude: null,
    freeform_address: subtitles(result),
    categories: categories(result),
  }
}

export function mapSuggestResult(result = {}, sessionId = null) {
  const mapped = basePlace(result)
  const detailsId = detailArgument(result, 'id') ?? mapped.id
  return {
    ...mapped,
    details: detailsId ? { id: detailsId, session_id: sessionId } : null,
  }
}

export function mapPlaceDetails(result = {}) {
  const mapped = basePlace(result)
  const address = result.address ?? {}
  const coordinates = Array.isArray(result.position?.coordinates)
    ? result.position.coordinates
    : []
  const longitude = coordinateOrNull(coordinates[0], LONGITUDE_MIN, LONGITUDE_MAX)
  const latitude = coordinateOrNull(coordinates[1], LATITUDE_MIN, LATITUDE_MAX)
  const pairedCoords = latitude !== null && longitude !== null

  return {
    ...mapped,
    street_and_number: toStreetAndNumber(address),
    postal_code: text(address.postalCode),
    city: text(address.municipality),
    region: text(address.countrySubdivision),
    country: text(address.countryCodeIso2)?.slice(0, 2).toUpperCase() ?? null,
    website: toWebsite(firstContactValue(result, 'websites')),
    phone: firstContactValue(result, 'phones'),
    latitude: pairedCoords ? latitude : null,
    longitude: pairedCoords ? longitude : null,
    details: null,
  }
}

function providerHeaders(attributes, { language = null, sessionId = null } = {}) {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'TomTom-Api-Key': API_KEY,
    'TomTom-Api-Version': API_VERSION,
    Attributes: attributes,
  })
  if (language) headers.set('Accept-Language', language)
  if (sessionId) headers.set('Session-Id', sessionId)
  return headers
}

async function requestJson(url, options, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn('placeSearch.request_failed', { err })
    return UPSTREAM_FAILED
  }
  if (!response.ok) {
    logger.warn('placeSearch.request_failed', { status: response.status })
    return UPSTREAM_FAILED
  }
  try {
    return { json: await response.json() }
  } catch (err) {
    logger.warn('placeSearch.request_failed', { err })
    return UPSTREAM_FAILED
  }
}

const norm = (value) => String(value ?? '').trim().toLowerCase()

// v3 filters have no city key — only countryCodesIso2 and geometry — so a known
// city narrows the search as query text, the way a person would type it. Skipped
// when the query already names it, to avoid "Paradiso Amsterdam Amsterdam".
function suggestQuery(query, city) {
  if (!city || norm(query).includes(norm(city))) return query
  return `${query} ${city}`
}

function suggestBody({ query, limit, lat, lon, country, city }) {
  const body = {
    query: suggestQuery(query, city),
    maxResults: limit,
    filters: { types: ['poi'] },
  }
  if (country) body.filters.countryCodesIso2 = [country]
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
    const point = { type: 'point', coordinates: [lon, lat] }
    body.origin = point
    body.preferences = { geometry: point }
  }
  return body
}

function cacheKey({ query, limit, language, lat, lon, country, city, sessionId }) {
  return [
    'suggest', norm(query), limit, norm(language), lat ?? '', lon ?? '',
    country ?? '', norm(city), sessionId ?? '',
  ].join('|')
}

async function requestPlaces(params, fetchImpl) {
  const requested = await requestJson(SUGGEST_URL, {
    method: 'POST',
    headers: providerHeaders(SUGGEST_ATTRIBUTES, params),
    body: JSON.stringify(suggestBody(params)),
  }, fetchImpl)
  if (requested.error) return requested

  const results = Array.isArray(requested.json?.results) ? requested.json.results : []
  const items = results
    .filter((result) => result?.type === 'poi')
    .map((result) => mapSuggestResult(result, params.sessionId))
    .filter((item) => item.name)
  return { items, meta: { limit: params.limit, returned: items.length } }
}

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

  const promise = requestPlaces(params, fetchImpl)
    .then((result) => {
      if (!result.error) writeCache(key, result)
      return result
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, promise)
  return promise
}

export async function getPlaceDetails(input = {}, { fetchImpl = globalThis.fetch } = {}) {
  const parsed = parsePlaceDetailsParams(input)
  if (parsed.error) return badRequest(parsed.error)
  if (!API_KEY) return NOT_CONFIGURED
  if (typeof fetchImpl !== 'function') return UPSTREAM_FAILED

  const { id, sessionId } = parsed.params
  const requested = await requestJson(`${API_BASE}/details/pois/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: providerHeaders(DETAILS_ATTRIBUTES, { sessionId }),
  }, fetchImpl)
  if (requested.error) return requested
  return mapPlaceDetails(requested.json)
}

export function isPlaceSearchConfigured() {
  return Boolean(API_KEY)
}

export function resetPlaceSearchCacheForTests() {
  cache.clear()
  inflight.clear()
}
