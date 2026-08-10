// Input parsing for user-level availability. No DB access here.
import { isIsoDate } from '../utils/periodQuery.js'

export const VALID_STATUSES = new Set(['available', 'unavailable'])
export const USER_SLOT_FIELDS = ['start_date', 'end_date', 'status', 'reason']

const MAX_REASON_LENGTH = 200

// Cross-field validation shared by create and patch. Returns an error string,
// or null when valid.
export function validateUserSlot({ start_date, end_date, status, reason }) {
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return 'status must be available or unavailable'
  }
  if (start_date !== undefined && !isIsoDate(start_date)) return 'start_date must be YYYY-MM-DD'
  if (end_date !== undefined && !isIsoDate(end_date)) return 'end_date must be YYYY-MM-DD'
  if (start_date && end_date && end_date < start_date) {
    return 'end_date must be >= start_date'
  }
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') return 'reason must be a string'
    if (reason.length > MAX_REASON_LENGTH) return `reason must be at most ${MAX_REASON_LENGTH} characters`
  }
  return null
}

export function buildUserSlotUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of USER_SLOT_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(key === 'reason' ? (body[key] || null) : body[key])
    }
  }
  return { fields, values }
}

// The two privacy flags. Both are booleans and nothing else — a truthy string
// must not silently turn sharing on.
export const VISIBILITY_FIELDS = ['availability_detail_visible', 'cross_band_gig_detail_visible']

export function buildVisibilityUpdate(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of VISIBILITY_FIELDS) {
    if (!(key in (body ?? {}))) continue
    if (typeof body[key] !== 'boolean') return { error: `${key} must be a boolean` }
    fields.push(`${key} = $${idx++}`)
    values.push(body[key])
  }
  if ('travel_margin_hours' in (body ?? {})) {
    const margin = body.travel_margin_hours
    if (!Number.isInteger(margin) || margin < 0 || margin > 24) {
      return { error: 'travel_margin_hours must be an integer from 0 to 24' }
    }
    fields.push(`availability_travel_margin_hours = $${idx++}`)
    values.push(margin)
  }
  return { fields, values }
}
