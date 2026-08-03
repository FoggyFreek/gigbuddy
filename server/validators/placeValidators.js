// Pure input parsing for the place-lookup service.
import { parseSearchLimit } from './common.js'

const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 120
// Well under parseSearchLimit's 25 ceiling: this fronts a metered upstream hit
// once per debounced keystroke, and TomTom's typeahead limit is 10.
const MAX_LIMIT = 10

function parseBiasCoordinate(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return { value: null }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return { error: true }
  return { value: parsed }
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

  const lat = parseBiasCoordinate(query.lat, -90, 90)
  const lon = parseBiasCoordinate(query.lon, -180, 180)
  if (lat.error || lon.error) return { error: 'lat/lon must be valid coordinates' }
  // A lone bound is not a bias point; ignore the half pair rather than 400 on it.
  const paired = lat.value !== null && lon.value !== null

  const language = String(query.language ?? '').trim().slice(0, 10) || null

  return {
    params: {
      query: raw,
      limit,
      language,
      lat: paired ? lat.value : null,
      lon: paired ? lon.value : null,
    },
  }
}

export { MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_LIMIT }
