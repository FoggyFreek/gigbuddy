// Input parsing and validation for rehearsal routes. No DB access here.

export const VALID_STATUSES = new Set(['option', 'planned'])
export const VALID_VOTES = new Set(['yes', 'no'])

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Builds SET fragments ($1..$N) from the allowed PATCH fields. Status validity
// is checked by the service before this runs.
export function buildRehearsalUpdateFields(body) {
  const allowed = ['proposed_date', 'start_time', 'end_time', 'location', 'notes', 'status']
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }
  return { fields, values }
}

export function normalizeExtraMemberIds(extraMemberIds) {
  return Array.isArray(extraMemberIds)
    ? extraMemberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : []
}
