// Input parsing and validation for venue routes. No DB access here.
import { parsePositiveId as parseId, parseSearchLimit } from './common.js'
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'

export const VALID_CATEGORIES = new Set(['venue', 'festival'])
export const VALID_GIG_ACTIONS = new Set(['migrate', 'remove'])

export const EDITABLE_FIELDS = [
  'category',
  'name',
  'title',
  'given_name',
  'family_name',
  'organization_name',
  'street_and_number',
  'street_additional',
  'postal_code',
  'city',
  'region',
  'country',
  'website',
  'phone',
  'email',
]

export { parseId, parseSearchLimit }

function normalizeInsertWebsite(body) {
  try {
    return normalizeOptionalUrl(body.website, { allowedProtocols: WEB_URL_PROTOCOLS })
  } catch {
    return null
  }
}

function normalizeInsertField(key, body) {
  if (key === 'category') return VALID_CATEGORIES.has(body.category) ? body.category : 'venue'
  if (key === 'name') return String(body.name).trim()
  if (key === 'website') return normalizeInsertWebsite(body)
  return body[key] || null
}

export function buildInsertValues(tenantId, body) {
  return [
    tenantId,
    ...EDITABLE_FIELDS.map((key) => normalizeInsertField(key, body)),
  ]
}

function normalizePatchField(key, value) {
  if (key === 'country') return value || null
  if (key === 'website') {
    return normalizeOptionalUrl(value, { allowedProtocols: WEB_URL_PROTOCOLS })
  }
  return value
}

// Builds SET fragments ($1..$N) from the allowed PATCH fields. Returns
// { error } when a provided value is invalid.
export function buildVenueUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1

  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue
    if (key === 'category' && !VALID_CATEGORIES.has(body[key])) {
      return { error: 'Invalid category value' }
    }
    fields.push(`${key} = $${idx++}`)
    values.push(normalizePatchField(key, body[key]))
  }

  return { fields, values, idx }
}

export function normalizeImportName(row) {
  return row.name ? String(row.name).trim() : ''
}

export function normalizeImportCity(row) {
  return row.city ? String(row.city).trim() : ''
}

export function venueImportKey(name, city) {
  return `${name.toLowerCase()} ${city.toLowerCase()}`
}

export function collectIncomingNames(rows) {
  return [
    ...new Set(rows.map(normalizeImportName).filter(Boolean).map((name) => name.toLowerCase())),
  ]
}

export function normalizeImportRow(row) {
  const name = normalizeImportName(row)
  if (!name) return null

  const city = normalizeImportCity(row)
  return {
    body: { ...row, name, city },
    key: venueImportKey(name, city),
  }
}
