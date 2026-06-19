// Pure request/query validation for ledger routes. No DB access here.

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Clamp a requested search result limit to a sane range (default 10, max 25).
export function parseSearchLimit(value) {
  const parsedLimit = Number.parseInt(value, 10)
  return Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
}

// Parse the `accounts` query param (comma-separated account codes) into a
// deduped list of valid codes. Anything malformed is dropped; missing/blank
// yields [] (the service then returns no rows without scanning the ledger).
export function parseAccountCodes(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return []
  return [...new Set(value.split(',').map((c) => c.trim()).filter((c) => /^[0-9]{4,6}$/.test(c)))]
}
