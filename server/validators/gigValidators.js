// Pure request/parameter validation and update-field construction for gig
// routes. No DB or IO here.

export const VALID_STATUSES = ['option', 'confirmed', 'announced']
export const VALID_VOTES = ['yes', 'no']

export const GIG_PATCH_FIELDS = [
  'event_date', 'event_description', 'venue_id', 'festival_id', 'event_link',
  'start_time', 'end_time', 'status', 'booking_fee_cents', 'admission',
  'ticket_link', 'notes',
  'has_pa_system', 'has_drumkit', 'has_stage_lights',
]

export const GIG_TASK_PATCH_FIELDS = ['title', 'done', 'due_date', 'assigned_to']

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

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
