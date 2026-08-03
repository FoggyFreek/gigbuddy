// Pure query parsing for the generic place-search endpoint.
const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 120
const DEFAULT_LIMIT = 8
// TomTom caps typeahead usefulness well below its 100-result ceiling, and this
// is a metered upstream — keep the window small.
const MAX_LIMIT = 10

function parseBiasCoordinate(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return { value: null }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return { error: true }
  return { value: parsed }
}

// `{ params }` for the service, or `{ error }` with a 400 message.
export function parsePlaceQuery(query = {}) {
  const raw = String(query.q ?? '').trim()
  if (raw.length < MIN_QUERY_LENGTH) {
    return { error: `q must be at least ${MIN_QUERY_LENGTH} characters` }
  }
  if (raw.length > MAX_QUERY_LENGTH) {
    return { error: `q must be at most ${MAX_QUERY_LENGTH} characters` }
  }

  const parsedLimit = Number.parseInt(query.limit, 10)
  const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT, MAX_LIMIT))

  const lat = parseBiasCoordinate(query.lat, -90, 90)
  const lon = parseBiasCoordinate(query.lon, -180, 180)
  if (lat.error || lon.error) return { error: 'lat/lon must be valid coordinates' }
  // A lone bound is not a bias point; ignore the half-pair rather than 400 on it.
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

export { MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_LIMIT, DEFAULT_LIMIT }
