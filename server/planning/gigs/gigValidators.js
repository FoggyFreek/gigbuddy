// Pure request/parameter validation and update-field construction for gig
// routes. No DB or IO here.
import { parsePositiveId as parseId, parseSearchLimit } from '../../platform/http/requestValidators.js'
import { resolveEventEndDate, timeToMinutes } from '../../../shared/eventTimes.js'
import {
  MAX_GIG_INFO_CONTENT_LENGTH,
  MAX_GIG_INFO_LABEL_LENGTH,
  isGigInfoLabelKey,
} from '../../../shared/gigInfoLabels.js'

export const VALID_STATUSES = ['option', 'confirmed', 'announced']
export const VALID_VOTES = ['yes', 'no']
export const MAX_GIG_TAGS = 20
export const MAX_GIG_TAG_LENGTH = 50
export const MAX_GIG_COSTS = 50
export const MAX_GIG_COST_LABEL_LENGTH = 100
export const MAX_GIG_TIMETABLE_ENTRIES = 100
export const MAX_GIG_TIMETABLE_DESCRIPTION_LENGTH = 500

// Deal vocabulary — kept in step with the CHECK constraints in migration 189
// and with the frontend engine in src/planning/gigs/dealTerms.ts.
export const VALID_DEAL_TYPES = ['flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal']
export const VALID_FEE_BASES = ['none', 'percentage', 'amount']
export const VALID_AGENCY_FEE_MODES = ['exclusive', 'inclusive']

// INTEGER columns; anything larger is a client bug, not a 500 from Postgres.
const MAX_INT4 = 2147483647

export const GIG_PATCH_FIELDS = [
  'event_date', 'end_date', 'event_description', 'venue_id', 'festival_id', 'event_link',
  'start_time', 'end_time', 'status', 'guaranteed_fee_cents', 'admission',
  'ticket_link', 'notes', 'percentage_of_sales',
  // Deal terms (migration 189). percentage_of_sales above doubles as the
  // artist's ticket share; the venue's is the remainder of 100.
  'deal_type', 'breakeven_includes_venue_costs',
  'venue_costs_cents', 'venue_capacity', 'expected_visitors', 'tickets_sold',
  'ticket_price_net_cents', 'ticket_price_gross_cents',
  'agency_fee_basis', 'agency_fee_percentage', 'agency_fee_amount_cents', 'agency_fee_mode',
  'commission_basis', 'commission_percentage', 'commission_amount_cents',
  // Only meaningful in a personal workspace; the route gates the field on the
  // MY_BANDS capability and the service validates it against my_bands.
  'my_band_id',
]

// Guards before Number() because Number('') / Number(' ') / Number(false) /
// Number([]) all coerce to 0 — those must be rejected, not silently stored as 0.
function parseNumeric(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Percentage stored as NUMERIC(5,2), range 0–100 (the DB also CHECKs this).
function percentIn(key, raw, { nullable }) {
  if (raw === null) return nullable ? { value: null } : { error: `Invalid ${key}` }
  const n = parseNumeric(raw)
  if (n === null || n < 0 || n > 100) return { error: `Invalid ${key}` }
  return { value: n }
}

// Non-negative whole number for an INTEGER column (cents, capacities, counts).
function wholeIn(key, raw, { nullable }) {
  if (raw === null) return nullable ? { value: null } : { error: `Invalid ${key}` }
  const n = parseNumeric(raw)
  if (n === null || !Number.isInteger(n) || n < 0 || n > MAX_INT4) return { error: `Invalid ${key}` }
  return { value: n }
}

function oneOf(allowed) {
  return (key, raw) => (allowed.includes(raw) ? { value: raw } : { error: `Invalid ${key}` })
}

function booleanIn(key, raw) {
  return typeof raw === 'boolean' ? { value: raw } : { error: `Invalid ${key}` }
}

const nullablePercent = (key, raw) => percentIn(key, raw, { nullable: true })
const requiredPercent = (key, raw) => percentIn(key, raw, { nullable: false })
const nullableWhole = (key, raw) => wholeIn(key, raw, { nullable: true })
const requiredWhole = (key, raw) => wholeIn(key, raw, { nullable: false })

// Per-field normalization for the PATCH whitelist. A field with no entry here
// is passed through as-is (text, dates, ids — validated elsewhere or by the DB).
// The NOT NULL columns use the required* variants so `null` is a 400 rather
// than a constraint violation surfacing as a 500.
const GIG_FIELD_NORMALIZERS = {
  percentage_of_sales: nullablePercent,
  guaranteed_fee_cents: nullableWhole,
  venue_costs_cents: nullableWhole,
  ticket_price_net_cents: nullableWhole,
  ticket_price_gross_cents: nullableWhole,
  venue_capacity: nullableWhole,
  expected_visitors: nullableWhole,
  tickets_sold: nullableWhole,
  deal_type: oneOf(VALID_DEAL_TYPES),
  agency_fee_basis: oneOf(VALID_FEE_BASES),
  agency_fee_mode: oneOf(VALID_AGENCY_FEE_MODES),
  commission_basis: oneOf(VALID_FEE_BASES),
  breakeven_includes_venue_costs: booleanIn,
  agency_fee_percentage: requiredPercent,
  commission_percentage: requiredPercent,
  agency_fee_amount_cents: requiredWhole,
  commission_amount_cents: requiredWhole,
}

// A gig cost line: a free-text label (travel, backline, catering, …) and a
// non-negative amount in cents. Returns { error } or { data }.
export function normalizeGigCost(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid cost' }
  }
  const label = String(body.label ?? '').trim()
  if (!label) return { error: 'Invalid label' }
  if (label.length > MAX_GIG_COST_LABEL_LENGTH) return { error: 'Invalid label' }

  const amount = requiredWhole('amount_cents', body.amount_cents ?? 0)
  if (amount.error) return { error: amount.error }

  if (body.position === undefined || body.position === null) {
    return { data: { label, amount_cents: amount.value, position: null } }
  }
  const position = requiredWhole('position', body.position)
  if (position.error) return { error: position.error }
  return { data: { label, amount_cents: amount.value, position: position.value } }
}

// An "Additional information" block: a label plus free-form multi-line text.
// The label is either a canonical key from shared/gigInfoLabels.js or text the
// user typed, told apart by the explicit `label_is_custom` flag — the two
// always travel together so a patch can never leave the pair inconsistent.
function normalizeInfoBlockLabel(body) {
  const isCustom = body.label_is_custom
  if (typeof isCustom !== 'boolean') return { error: 'Invalid label_is_custom' }
  const raw = body.label
  if (typeof raw !== 'string') return { error: 'Invalid label' }
  if (!isCustom) {
    return isGigInfoLabelKey(raw)
      ? { data: { label: raw, label_is_custom: false } }
      : { error: 'Invalid label' }
  }
  const label = raw.trim()
  if (!label || label.length > MAX_GIG_INFO_LABEL_LENGTH) return { error: 'Invalid label' }
  return { data: { label, label_is_custom: true } }
}

function normalizeInfoBlockContent(raw) {
  if (typeof raw !== 'string') return { error: 'Invalid content' }
  if (raw.length > MAX_GIG_INFO_CONTENT_LENGTH) return { error: 'Invalid content' }
  return { data: raw }
}

// Full body for a create. Returns { error } or { data }.
export function normalizeGigInfoBlock(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid info block' }
  }
  const label = normalizeInfoBlockLabel({ label_is_custom: false, ...body })
  if (label.error) return { error: label.error }

  const content = normalizeInfoBlockContent(body.content ?? '')
  if (content.error) return { error: content.error }

  if (body.position === undefined || body.position === null) {
    return { data: { ...label.data, content: content.data, position: null } }
  }
  const position = requiredWhole('position', body.position)
  if (position.error) return { error: position.error }
  return { data: { ...label.data, content: content.data, position: position.value } }
}

// Partial body for a patch: only the keys actually sent are written, so the
// debounced content save and the label picker never overwrite each other.
export function normalizeGigInfoBlockPatch(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid info block' }
  }
  const patch = {}

  if ('label' in body || 'label_is_custom' in body) {
    const label = normalizeInfoBlockLabel(body)
    if (label.error) return { error: label.error }
    Object.assign(patch, label.data)
  }

  if ('content' in body) {
    const content = normalizeInfoBlockContent(body.content)
    if (content.error) return { error: content.error }
    patch.content = content.data
  }

  if ('position' in body) {
    const position = requiredWhole('position', body.position)
    if (position.error) return { error: position.error }
    patch.position = position.value
  }

  if (Object.keys(patch).length === 0) return { error: 'No fields to update' }
  return { data: patch }
}

export const GIG_TASK_PATCH_FIELDS = ['title', 'done', 'due_date', 'assigned_to']

export { parseId, parseSearchLimit }
export { toDateStr } from '../../utils/dateOnly.js'

export function venueDisplay(v) {
  if (!v) return ''
  return [v.name, v.city].filter(Boolean).join(' · ')
}

// Trims blanks and dedupes case-insensitively while preserving the spelling of
// the first occurrence. The repository also enforces this per tenant.
export function normalizeGigTagNames(tags) {
  const names = new Map()
  for (const value of tags) {
    const name = String(value ?? '').trim()
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
  }
  return [...names.values()]
}

// Returns a copy of body with the id references parsed to validated integers
// (input is left untouched). Returns { error } when a provided id is
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

  if (start_time && end_time && timeToMinutes(start_time) === timeToMinutes(end_time)) {
    return { error: 'end_time must be after start_time' }
  }
  const end_date = resolveEventEndDate(event_date, event_date, start_time, end_time)

  return {
    data: {
      event_date, end_date, event_description, venueId, festivalId,
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
      const normalize = GIG_FIELD_NORMALIZERS[key]
      if (normalize) {
        const result = normalize(key, body[key])
        if (result.error) return { error: result.error }
        fields.push(`${key} = $${idx++}`)
        values.push(result.value)
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

// --- Gig timetable (the running order of the gig day, on the Tasks tab) ---

// Both times are optional: a line is added before it is filled in, and one may
// carry only a description. Beyond the clock format nothing is checked — a
// zero-length item (end == start) and a timetable running past midnight are
// both normal, so no ordering rule is imposed.
function normalizeTimetableTime(raw, field) {
  if (raw === null || raw === undefined || raw === '') return { data: null }
  if (typeof raw !== 'string' || !TIME_RE.test(raw)) return { error: `Invalid ${field}` }
  return { data: raw }
}

function normalizeTimetableDescription(raw) {
  if (typeof raw !== 'string') return { error: 'Invalid description' }
  if (raw.length > MAX_GIG_TIMETABLE_DESCRIPTION_LENGTH) return { error: 'Invalid description' }
  return { data: raw }
}

// Full body for a create; every field may be omitted, since the UI persists the
// line as soon as it is added and fills it in afterwards.
export function normalizeGigTimetableEntry(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid timetable entry' }
  }
  const start = normalizeTimetableTime(body.start_time, 'start_time')
  if (start.error) return { error: start.error }
  const end = normalizeTimetableTime(body.end_time, 'end_time')
  if (end.error) return { error: end.error }
  const description = normalizeTimetableDescription(body.description ?? '')
  if (description.error) return { error: description.error }

  return {
    data: { start_time: start.data, end_time: end.data, description: description.data },
  }
}

// Partial body for a patch: only the keys actually sent are written, so the
// debounced description save and a time pick never overwrite each other.
export function normalizeGigTimetableEntryPatch(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid timetable entry' }
  }
  const patch = {}

  for (const field of ['start_time', 'end_time']) {
    if (!(field in body)) continue
    const time = normalizeTimetableTime(body[field], field)
    if (time.error) return { error: time.error }
    patch[field] = time.data
  }

  if ('description' in body) {
    const description = normalizeTimetableDescription(body.description)
    if (description.error) return { error: description.error }
    patch.description = description.data
  }

  if (Object.keys(patch).length === 0) return { error: 'No fields to update' }
  return { data: patch }
}

// Body of PATCH /:id/timetable/reorder. Returns { error } or { orderedEntryIds }.
export function parseOrderedTimetableIds(body) {
  const orderedEntryIds = body?.orderedEntryIds
  if (!Array.isArray(orderedEntryIds) || orderedEntryIds.some((x) => parseId(x) === null)) {
    return { error: 'orderedEntryIds must be an array of ids' }
  }
  return { orderedEntryIds: orderedEntryIds.map(Number) }
}
