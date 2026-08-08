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

// Strict parsing of an inclusive day window (`?from=YYYY-MM-DD&to=YYYY-MM-DD`)
// for windowed collection endpoints. Both bounds are required — an omitted
// bound would be an unbounded scan — and malformed input is rejected, not
// clamped, so clients can detect contract mistakes.
export function parseDateRange(query) {
  const from = query?.from
  const to = query?.to
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null
  return { from, to }
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
