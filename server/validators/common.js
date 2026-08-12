// Shared pure parsing primitives. Resource validators re-export these under
// their existing names so routes keep their current API and error behavior.
import { isIsoDate } from '../utils/periodQuery.js'

export function parsePositiveId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function parseIntegerId(value) {
  const id = Number(value)
  return Number.isInteger(id) ? id : null
}

// Clamp a requested search result limit to the established default/range used
// by resource search endpoints.
export function parseSearchLimit(value) {
  const parsedLimit = Number.parseInt(value, 10)
  return Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
}

export const DEFAULT_LIST_LIMIT = 10
export const MAX_LIST_LIMIT = 100

// Strict limit parsing for public limited-collection endpoints. Unlike search
// limits, malformed values are rejected instead of silently clamped so clients
// can detect contract mistakes.
export function parseListLimit(value, maxLimit = MAX_LIST_LIMIT) {
  if (value === undefined) return DEFAULT_LIST_LIMIT
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const raw = String(value)
  if (!/^[1-9]\d*$/.test(raw)) return null
  const limit = Number(raw)
  return limit <= maxLimit ? limit : null
}

// A year. Reads that fan out over several range-scoped queries per request —
// anything availability-enriched — pass this as `maxDays` so an absurd window
// is refused BEFORE the fetch. Capping the computed result instead (see
// MAX_SPAN_DAYS) bounds only the response, never the work. Lean single-query
// projections like the gig map stay deliberately uncapped.
export const MAX_RANGE_DAYS = 366

export const INVALID_RANGE = 'from and to must be valid ISO dates (YYYY-MM-DD) with from <= to'
export const INVALID_BOUNDED_RANGE = `${INVALID_RANGE}, at most ${MAX_RANGE_DAYS} days apart`

/** The message matching the cap actually applied, so a 400 explains itself. */
export const rangeErrorMessage = (maxDays) => (
  Number.isFinite(maxDays) ? INVALID_BOUNDED_RANGE : INVALID_RANGE
)

const DAY_MS = 86400000

// Strict parsing of an inclusive day window (`?from=YYYY-MM-DD&to=YYYY-MM-DD`)
// for windowed collection endpoints. Both bounds are required — an omitted
// bound would be an unbounded scan — and malformed or over-wide input is
// rejected, not clamped, so clients can detect contract mistakes.
export function parseDateRange(query, maxDays = Infinity) {
  const from = query?.from
  const to = query?.to
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null
  if (Number.isFinite(maxDays)) {
    const days = ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
    if (days > maxDays) return null
  }
  return { from, to }
}

const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/

export function validateDailyTimeRange(startTime, endTime) {
  if (startTime != null && startTime !== '' && !LOCAL_TIME_RE.test(startTime)) return 'start_time must be HH:mm'
  if (endTime != null && endTime !== '' && !LOCAL_TIME_RE.test(endTime)) return 'end_time must be HH:mm'
  if (startTime && endTime && endTime <= startTime) return 'end_time must be after start_time'
  return null
}

// Optional keyset cursor for "load more" pagination on bounded feeds
// (`?cursorDate=YYYY-MM-DD&cursorId=123`), keyed on (date, id) to match the
// feed's ORDER BY tiebreak. Both params are required together; omitting both
// means "first page". Never use OFFSET-style page/offset params instead.
export const INVALID_CURSOR = 'cursorDate and cursorId must be provided together and valid'

export function parseListCursor(query) {
  const cursorDate = query?.cursorDate
  const cursorId = query?.cursorId
  if (cursorDate === undefined && cursorId === undefined) return { cursor: null }
  if (!isIsoDate(cursorDate)) return null
  const id = parsePositiveId(cursorId)
  if (id === null) return null
  return { cursor: { date: cursorDate, id } }
}

// Search over rows the caller has no membership in — the band directory and the
// global band profiles. A picker, not a feed: queries shorter than the minimum
// would return most of the table, so they are refused rather than silently
// broadened, and the limit is capped hard.
//
// Returns { error: '<code>' } | { query, limit }, the discriminated shape these
// endpoints report to the client as a machine-readable code.
export const MIN_DISCOVERY_QUERY_LENGTH = 3
const MAX_DISCOVERY_QUERY_LENGTH = 100
const DISCOVERY_LIMIT = 10

export function parseDiscoverySearch(query, { requireQuery = true } = {}) {
  const raw = typeof query?.q === 'string' ? query.q.trim() : ''
  if (!(raw === '' && !requireQuery)) {
    if (raw.length < MIN_DISCOVERY_QUERY_LENGTH) return { error: 'query_too_short' }
    if (raw.length > MAX_DISCOVERY_QUERY_LENGTH) return { error: 'query_too_long' }
  }

  const requested = query?.limit
  let limit = DISCOVERY_LIMIT
  if (requested !== undefined && requested !== '') {
    limit = Number(requested)
    if (!Number.isInteger(limit) || limit < 1) return { error: 'invalid_limit' }
    limit = Math.min(limit, DISCOVERY_LIMIT)
  }
  return { query: raw, limit }
}

// The full-precision twin of parseListCursor, for feeds ordered by a
// TIMESTAMPTZ rather than a DATE. A day-granular cursor cannot page those: many
// rows share a calendar day, so resuming from a date alone skips the rest of
// that day or repeats it.
//
// One opaque `?cursor=` param (base64url of `<iso instant>|<id>`) rather than a
// visible pair, precisely so a caller cannot pass a plain date and silently
// lose the time the ordering depends on — a malformed value is rejected, never
// coerced into "first page".
export const INVALID_TIMESTAMP_CURSOR = 'cursor must be a value returned as meta.nextCursor'

export function parseTimestampCursor(query) {
  const raw = query?.cursor
  if (raw === undefined) return { cursor: null }
  if (typeof raw !== 'string' || raw === '') return null

  let decoded
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separator = decoded.lastIndexOf('|')
  if (separator === -1) return null

  const at = decoded.slice(0, separator)
  const id = parsePositiveId(decoded.slice(separator + 1))
  if (id === null || !isValidIsoDate(at)) return null
  // Round-trip through Date to reject values Date.parse accepts loosely and to
  // hand the repository one canonical instant.
  const instant = new Date(at)
  if (instant.toISOString() !== at) return null

  return { cursor: { at, id } }
}

export function encodeTimestampCursor(at, id) {
  const instant = at instanceof Date ? at : new Date(at)
  return Buffer.from(`${instant.toISOString()}|${id}`).toString('base64url')
}

export const INVALID_TODAY = 'today must be a valid ISO date (YYYY-MM-DD)'

// Calendar-day cutoff supplied by the browser. This intentionally represents
// the user's local date rather than the API or database server's date.
export function parseLocalDate(value) {
  return isIsoDate(value) ? value : null
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false
  return !Number.isNaN(Date.parse(value))
}

export function trimOrNull(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}
