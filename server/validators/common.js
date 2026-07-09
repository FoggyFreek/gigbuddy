// Shared pure parsing primitives. Resource validators re-export these under
// their existing names so routes keep their current API and error behavior.

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

export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false
  return !Number.isNaN(Date.parse(value))
}

export function trimOrNull(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}
