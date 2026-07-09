// Input parsing and validation for availability routes. No DB access here.
import { parsePositiveId as parseId } from './common.js'

export const SLOT_FIELDS = ['band_member_id', 'start_date', 'end_date', 'status', 'reason']
export const VALID_STATUSES = new Set(['available', 'unavailable'])

export { parseId }

// Cross-field slot validation. Returns an error string, or null when valid.
export function validateSlot({ start_date, end_date, status }) {
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return 'status must be available or unavailable'
  }
  if (start_date && end_date && end_date < start_date) {
    return 'end_date must be >= start_date'
  }
  return null
}

// Builds SET fragments ($1..$N) from the allowed PATCH fields.
export function buildSlotUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of SLOT_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
