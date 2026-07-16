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
