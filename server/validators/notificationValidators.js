// Input parsing and validation for notification routes. No DB access here.
import { parsePositiveId as parseId } from './common.js'
import { NOTIFICATION_TYPES } from '../services/notificationTypes.js'

const VALID_TYPES = new Set(NOTIFICATION_TYPES)

export { parseId }

// Parses a preferences PUT body of shape
//   { types?: [{ type, enabled }], tenants?: [{ tenantId, enabled }] }
// Returns { error: string } on invalid input, else normalized
// { types: [...], tenants: [...] } (both always arrays). Membership of the
// tenant ids is checked by the service (DB), not here.
function parseTypeEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return { error: 'Invalid type preference' }
  if (!VALID_TYPES.has(entry.type)) return { error: 'Unknown notification type' }
  if (typeof entry.enabled !== 'boolean') return { error: 'enabled must be a boolean' }
  return { value: { type: entry.type, enabled: entry.enabled } }
}

function parseTenantEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return { error: 'Invalid tenant preference' }
  const tenantId = parseId(entry.tenantId)
  if (tenantId === null) return { error: 'Invalid tenantId' }
  if (typeof entry.enabled !== 'boolean') return { error: 'enabled must be a boolean' }
  return { value: { tenantId, enabled: entry.enabled } }
}

// An absent list is valid and normalizes to [].
function parseEntryList(list, name, parseEntry) {
  if (list === undefined) return { values: [] }
  if (!Array.isArray(list)) return { error: `${name} must be an array` }
  const values = []
  for (const entry of list) {
    const result = parseEntry(entry)
    if (result.error) return { error: result.error }
    values.push(result.value)
  }
  return { values }
}

export function parsePrefsBody(body) {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid body' }

  const types = parseEntryList(body.types, 'types', parseTypeEntry)
  if (types.error) return { error: types.error }

  const tenants = parseEntryList(body.tenants, 'tenants', parseTenantEntry)
  if (tenants.error) return { error: tenants.error }

  return { types: types.values, tenants: tenants.values }
}
