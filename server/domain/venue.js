// Pure venue-domain constants and normalization shared across layers.
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'
import {
  normalizeOptionalRegistrationNumber,
  normalizeOptionalVatId,
} from '../utils/businessIdentifiers.js'

export const VALID_VENUE_CATEGORIES = new Set(['venue', 'festival'])

export const VENUE_EDITABLE_FIELDS = [
  'category',
  'name',
  'title',
  'given_name',
  'family_name',
  'organization_name',
  'kvk_number',
  'tax_id',
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

// Coordinates are persisted for map/geocoder reuse. They stay outside
// VENUE_EDITABLE_FIELDS so venue forms and PATCH never expose them as editable
// fields
export const VENUE_COORDINATE_FIELDS = ['latitude', 'longitude']
export const VENUE_INSERT_FIELDS = [...VENUE_EDITABLE_FIELDS, ...VENUE_COORDINATE_FIELDS]

function parseCoordinate(value, min, max, field) {
  if (value === null || value === undefined || String(value).trim() === '') return { value: null }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { error: `${field} must be a number between ${min} and ${max}` }
  }
  return { value: parsed }
}

// The one owner of the coordinate-pair rule, shared by import, create and enrich.
// Mirrors the venues_latitude_range / venues_longitude_range /
// venues_coordinate_pair constraints so a bad pair fails before it reaches SQL.
// Returns `{ latitude, longitude }` or `{ error }`.
export function normalizeCoordinatePair(row = {}) {
  const latitude = parseCoordinate(row.latitude, -90, 90, 'latitude')
  if (latitude.error) return latitude
  const longitude = parseCoordinate(row.longitude, -180, 180, 'longitude')
  if (longitude.error) return longitude
  if ((latitude.value === null) !== (longitude.value === null)) {
    return { error: 'latitude and longitude must be provided together' }
  }
  return { latitude: latitude.value, longitude: longitude.value }
}

function normalizeInsertWebsite(body) {
  try {
    return normalizeOptionalUrl(body.website, { allowedProtocols: WEB_URL_PROTOCOLS })
  } catch {
    return null
  }
}

function normalizeInsertField(key, body) {
  if (key === 'category') return VALID_VENUE_CATEGORIES.has(body.category) ? body.category : 'venue'
  if (key === 'name') return String(body.name).trim()
  if (key === 'website') return normalizeInsertWebsite(body)
  if (key === 'kvk_number') return normalizeOptionalRegistrationNumber(body[key])
  if (key === 'tax_id') return normalizeOptionalVatId(body[key])
  if (VENUE_COORDINATE_FIELDS.includes(key)) return body[key] ?? null
  return body[key] || null
}

export function buildVenueInsertValues(tenantId, body) {
  return [
    tenantId,
    ...VENUE_INSERT_FIELDS.map((key) => normalizeInsertField(key, body)),
  ]
}

export function venueImportKey(name, city) {
  return `${name.toLowerCase()} ${city.toLowerCase()}`
}
