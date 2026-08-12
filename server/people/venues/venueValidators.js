// Input parsing and validation for venue routes. No DB access here.
import { parsePositiveId as parseId, parseSearchLimit } from '../../platform/http/requestValidators.js'
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../../utils/urls.js'
import {
  normalizeOptionalRegistrationNumber,
  normalizeOptionalVatId,
} from '../../utils/businessIdentifiers.js'
import {
  VALID_VENUE_CATEGORIES,
  VENUE_EDITABLE_FIELDS,
  buildVenueInsertValues,
  normalizeCoordinatePair,
  venueImportKey,
} from '../../domain/venue.js'

export const VALID_CATEGORIES = VALID_VENUE_CATEGORIES
export const VALID_GIG_ACTIONS = new Set(['migrate', 'remove'])

export const EDITABLE_FIELDS = VENUE_EDITABLE_FIELDS

export { parseId, parseSearchLimit }

export const buildInsertValues = buildVenueInsertValues

function normalizePatchField(key, value) {
  if (key === 'country') return value || null
  if (key === 'kvk_number') return normalizeOptionalRegistrationNumber(value)
  if (key === 'tax_id') return normalizeOptionalVatId(value)
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

export { venueImportKey }

export function collectIncomingNames(rows) {
  return [
    ...new Set(rows.map(normalizeImportName).filter(Boolean).map((name) => name.toLowerCase())),
  ]
}

export function normalizeImportRow(row) {
  const name = normalizeImportName(row)
  if (!name) return null

  const city = normalizeImportCity(row)
  const coordinates = normalizeCoordinatePair(row)
  if (coordinates.error) return coordinates
  return {
    body: { ...row, name, city, latitude: coordinates.latitude, longitude: coordinates.longitude },
    key: venueImportKey(name, city),
  }
}
