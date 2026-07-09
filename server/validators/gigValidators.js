// Pure request/parameter validation and update-field construction for gig
// routes. No DB or IO here.
import { parsePositiveId as parseId, parseSearchLimit } from './common.js'

export const VALID_STATUSES = ['option', 'confirmed', 'announced']
export const VALID_VOTES = ['yes', 'no']

export const GIG_PATCH_FIELDS = [
  'event_date', 'event_description', 'venue_id', 'festival_id', 'event_link',
  'start_time', 'end_time', 'status', 'booking_fee_cents', 'admission',
  'ticket_link', 'notes', 'merchandise_cut', 'percentage_of_sales',
  'has_pa_system', 'has_drumkit', 'has_stage_lights',
]

// Percentage fields stored as NUMERIC(5,2). Accepted from the client as a number
// or a numeric string, or null to clear. Range 0–100 (the DB also CHECKs this).
export const GIG_PERCENT_FIELDS = ['merchandise_cut', 'percentage_of_sales']

// Returns the normalized number for a percent field, or { error } when invalid.
// Guards before Number() because Number('') / Number(' ') / Number(false) /
// Number([]) all coerce to 0 — those must be rejected, not silently stored as 0.
function normalizePercent(key, raw) {
  if (raw === null) return { value: null }
  if (typeof raw !== 'number' && typeof raw !== 'string') return { error: `Invalid ${key}` }
  if (typeof raw === 'string' && raw.trim() === '') return { error: `Invalid ${key}` }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `Invalid ${key}` }
  return { value: n }
}

export const GIG_TASK_PATCH_FIELDS = ['title', 'done', 'due_date', 'assigned_to']

export { parseId, parseSearchLimit }

export function toDateStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).slice(0, 10)
}

export function venueDisplay(v) {
  if (!v) return ''
  return [v.name, v.city].filter(Boolean).join(' · ')
}

// Returns a copy of body with venue_id/festival_id parsed to validated
// integers (input is left untouched). Returns { error } when a provided id is
// malformed, otherwise { body: normalizedBody }.
export function normalizeGigVenueRefs(body) {
  const normalized = { ...body }
  for (const key of ['venue_id', 'festival_id']) {
    if (key in normalized && normalized[key] !== null) {
      const parsed = parseId(normalized[key])
      if (parsed === null) return { error: `Invalid ${key}` }
      normalized[key] = parsed
    }
  }
  return { body: normalized }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validateImportRowShape(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item))
    return { error: 'Each import row must be an object' }
  const { event_date, event_description, start_time, end_time } = item
  if (!event_date || !event_description) return { skip: true }
  if (!DATE_RE.test(event_date)) return { error: `Invalid event_date: ${event_date}` }
  if (start_time && !TIME_RE.test(start_time)) return { error: `Invalid start_time: ${start_time}` }
  if (end_time && !TIME_RE.test(end_time)) return { error: `Invalid end_time: ${end_time}` }
  return null
}

function parseImportRowId(value, fieldName) {
  if (value == null) return { id: null }
  const id = parseId(value)
  if (id === null) return { error: `Invalid ${fieldName}` }
  return { id }
}

function resolveImportRowStatus(status) {
  if (status == null) return { status: 'confirmed' }
  if (!VALID_STATUSES.includes(status)) return { error: `Invalid status: ${status}` }
  return { status }
}

// Validate and normalize a single import row. Returns one of:
//   { skip: true }        — row is missing required fields, count as skipped
//   { error: '...' }      — row is invalid, the import should abort with 400
//   { data: {...} }       — normalized, ready-to-insert column values
export function normalizeImportRow(item) {
  const shapeResult = validateImportRowShape(item)
  if (shapeResult) return shapeResult

  const {
    event_date, event_description, venue_id, festival_id,
    start_time, end_time, status, admission, event_link, ticket_link,
  } = item

  const venueResult = parseImportRowId(venue_id, 'venue_id')
  if (venueResult.error) return venueResult
  const { id: venueId } = venueResult

  const festivalResult = parseImportRowId(festival_id, 'festival_id')
  if (festivalResult.error) return festivalResult
  const { id: festivalId } = festivalResult

  const statusResult = resolveImportRowStatus(status)
  if (statusResult.error) return statusResult
  const { status: finalStatus } = statusResult

  return {
    data: {
      event_date, event_description, venueId, festivalId,
      start_time: start_time || null, end_time: end_time || null,
      status: finalStatus, admission: admission === 'paid' ? 'paid' : 'free',
      event_link: event_link || null, ticket_link: ticket_link || null,
    },
  }
}

// Builds the dynamic SET fragments/values for a gig UPDATE. Returns
// { error } for an invalid status, otherwise { fields, values }.
export function buildGigUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of GIG_PATCH_FIELDS) {
    if (key in body) {
      if (key === 'status' && !VALID_STATUSES.includes(body[key])) {
        return { error: 'Invalid status value' }
      }
      if (GIG_PERCENT_FIELDS.includes(key)) {
        const pct = normalizePercent(key, body[key])
        if (pct.error) return { error: pct.error }
        fields.push(`${key} = $${idx++}`)
        values.push(pct.value)
        continue
      }
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}

export function buildGigTaskUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of GIG_TASK_PATCH_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}
