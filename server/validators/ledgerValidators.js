// Pure request/query validation for ledger routes. No DB access here.
import { parsePositiveId as parseId, parseSearchLimit } from './common.js'

export { parseId, parseSearchLimit }

// Parse the `accounts` query param (comma-separated account codes) into a
// deduped list of valid codes. Anything malformed is dropped; missing/blank
// yields [] (the service then returns no rows without scanning the ledger).
export function parseAccountCodes(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return []
  return [...new Set(value.split(',').map((c) => c.trim()).filter((c) => /^[0-9]{4,6}$/.test(c)))]
}
