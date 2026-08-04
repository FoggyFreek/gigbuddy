// Pure input parsing for the place-lookup service.
import { parseSearchLimit } from './common.js'
import {
  LATITUDE_MAX, LATITUDE_MIN, LONGITUDE_MAX, LONGITUDE_MIN, parseCoordinate,
} from '../utils/coordinates.js'

const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 120
// Well under parseSearchLimit's 25 ceiling: this fronts a metered upstream hit
// once per debounced keystroke, and TomTom's typeahead limit is 10.
const MAX_LIMIT = 10
const MAX_CITY_LENGTH = 60
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/
const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseSessionId(value) {
  const sessionId = String(value ?? '').trim()
  if (!sessionId) return { value: null }
  if (!SESSION_ID_RE.test(sessionId)) return { error: 'sessionId must be a UUID v4 or v7' }
  return { value: sessionId }
}

// `{ params }` for the service, or `{ error }` carrying a 400 message.
export function parsePlaceQuery(query = {}) {
  const raw = String(query.q ?? '').trim()
  if (raw.length < MIN_QUERY_LENGTH) {
    return { error: `q must be at least ${MIN_QUERY_LENGTH} characters` }
  }
  if (raw.length > MAX_QUERY_LENGTH) {
    return { error: `q must be at most ${MAX_QUERY_LENGTH} characters` }
  }

  // Search-as-you-type clamps instead of 400ing — the documented
  // parseSearchLimit exception to the strict scope contract.
  const limit = Math.min(parseSearchLimit(query.limit), MAX_LIMIT)

  const lat = parseCoordinate(query.lat, LATITUDE_MIN, LATITUDE_MAX)
  const lon = parseCoordinate(query.lon, LONGITUDE_MIN, LONGITUDE_MAX)
  if (lat.error || lon.error) return { error: 'lat/lon must be valid coordinates' }
  // A lone bound is not a bias point; ignore the half pair rather than 400 on it.
  const paired = lat.value !== null && lon.value !== null

  const language = String(query.language ?? '').trim().slice(0, 10) || null
  const sessionId = parseSessionId(query.sessionId)
  if (sessionId.error) return { error: sessionId.error }

  // Country and city come from the record being edited, where the country is a
  // free-typed two-character field. A half-typed or junk value is dropped like a
  // half bias pair rather than 400ing the search the user is in the middle of.
  const rawCountry = String(query.country ?? '').trim()
  const country = COUNTRY_CODE_RE.test(rawCountry) ? rawCountry.toUpperCase() : null
  const city = String(query.city ?? '').trim().slice(0, MAX_CITY_LENGTH) || null

  return {
    params: {
      query: raw,
      limit,
      language,
      lat: paired ? lat.value : null,
      lon: paired ? lon.value : null,
      country,
      city,
      sessionId: sessionId.value,
    },
  }
}

export function parsePlaceDetailsParams({ id, sessionId } = {}) {
  const normalizedId = String(id ?? '').trim()
  if (!PLACE_ID_RE.test(normalizedId)) return { error: 'Invalid place id' }
  const parsedSessionId = parseSessionId(sessionId)
  if (parsedSessionId.error) return { error: parsedSessionId.error }
  return { params: { id: normalizedId, sessionId: parsedSessionId.value } }
}

export { MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_LIMIT }
