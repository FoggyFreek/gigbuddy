// Input parsing and validation for notification routes. No DB access here.
import { NOTIFICATION_TYPES } from '../services/notificationTypes.js'

const VALID_TYPES = new Set(NOTIFICATION_TYPES)

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Parses a preferences PUT body of shape
//   { types?: [{ type, enabled }], tenants?: [{ tenantId, enabled }] }
// Returns { error: string } on invalid input, else normalized
// { types: [...], tenants: [...] } (both always arrays). Membership of the
// tenant ids is checked by the service (DB), not here.
export function parsePrefsBody(body) {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid body' }

  const types = []
  if (body.types !== undefined) {
    if (!Array.isArray(body.types)) return { error: 'types must be an array' }
    for (const entry of body.types) {
      if (typeof entry !== 'object' || entry === null) return { error: 'Invalid type preference' }
      if (!VALID_TYPES.has(entry.type)) return { error: 'Unknown notification type' }
      if (typeof entry.enabled !== 'boolean') return { error: 'enabled must be a boolean' }
      types.push({ type: entry.type, enabled: entry.enabled })
    }
  }

  const tenants = []
  if (body.tenants !== undefined) {
    if (!Array.isArray(body.tenants)) return { error: 'tenants must be an array' }
    for (const entry of body.tenants) {
      if (typeof entry !== 'object' || entry === null) return { error: 'Invalid tenant preference' }
      const tenantId = parseId(entry.tenantId)
      if (tenantId === null) return { error: 'Invalid tenantId' }
      if (typeof entry.enabled !== 'boolean') return { error: 'enabled must be a boolean' }
      tenants.push({ tenantId, enabled: entry.enabled })
    }
  }

  return { types, tenants }
}
