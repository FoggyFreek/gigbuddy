// Input parsing for the band directory. No DB access here.
import { MAX_REQUEST_MESSAGE_LENGTH } from '../domain/membership.js'

// A picker, not a feed: short enough queries would return most of the
// directory, so they are refused rather than silently broadened.
const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 100
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10

// Returns { error: '<code>' } | { query, limit }.
export function parseDirectorySearch(query) {
  const raw = typeof query?.q === 'string' ? query.q.trim() : ''
  if (raw.length < MIN_QUERY_LENGTH) return { error: 'query_too_short' }
  if (raw.length > MAX_QUERY_LENGTH) return { error: 'query_too_long' }

  const requested = query?.limit
  let limit = DEFAULT_LIMIT
  if (requested !== undefined && requested !== '') {
    limit = Number(requested)
    if (!Number.isInteger(limit) || limit < 1) return { error: 'invalid_limit' }
    limit = Math.min(limit, MAX_LIMIT)
  }
  return { query: raw, limit }
}

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
