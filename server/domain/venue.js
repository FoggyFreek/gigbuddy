// Pure venue-domain constants and normalization shared across layers.
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../utils/urls.js'

export const VALID_VENUE_CATEGORIES = new Set(['venue', 'festival'])

export const VENUE_EDITABLE_FIELDS = [
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
  return body[key] || null
}

export function buildVenueInsertValues(tenantId, body) {
  return [
    tenantId,
    ...VENUE_EDITABLE_FIELDS.map((key) => normalizeInsertField(key, body)),
  ]
}

export function venueImportKey(name, city) {
  return `${name.toLowerCase()} ${city.toLowerCase()}`
}
