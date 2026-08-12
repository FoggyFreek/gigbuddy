// Input parsing for the band directory. No DB access here.
import { MAX_REQUEST_MESSAGE_LENGTH } from '../../domain/membership.js'
import { parseDiscoverySearch } from '../../validators/common.js'

// Shared with the global band-profile search: both answer questions about rows
// the caller has no membership in, so they get the same floor and ceiling.
export const parseDirectorySearch = parseDiscoverySearch

// The artist's note to the band. Optional — an artist may ask without writing
// anything. Plain text, trimmed, capped; never rendered as HTML or markdown.
// Returns { error: '<code>' } | { message } (message may be null).
export function parseRequestMessage(value) {
  if (value === undefined || value === null || value === '') return { message: null }
  if (typeof value !== 'string') return { error: 'invalid_request_message' }
  const trimmed = value.trim()
  if (trimmed === '') return { message: null }
  if (trimmed.length > MAX_REQUEST_MESSAGE_LENGTH) return { error: 'request_message_too_long' }
  return { message: trimmed }
}

export function parseTenantId(value) {
  const tenantId = Number(value)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { error: 'invalid_tenant_id' }
  return { tenantId }
}
