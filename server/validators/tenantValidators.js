// Input parsing and validation for tenant routes. No DB access here.
import { normalizeVatCountry } from '../../shared/vatRates.js'

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function validSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug)
}

// Room for a dedupe suffix ("-2".."-25" or "-xxxxxx") within the 64-char slug
// limit enforced by SLUG_RE.
const SLUG_BASE_MAX = 56

// Derives a slug base from a band name: strip diacritics, lowercase,
// non-alphanumerics collapse to single hyphens. Deterministic and pure —
// uniqueness is the caller's job (dedupe suffixes in tenantSelfService).
export function slugFromBandName(name) {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/, '')
  return base || 'band'
}

export const PATCHABLE = [
  'slug',
  'display_name',
  'band_name',
  'bio',
  'short_bio',
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
  'logo_path',
]

// Builds SET fragments ($1..$N) for a tenant PATCH. Returns { error } on an
// invalid slug, or { fields, values } (which may be empty).
export function buildTenantUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of PATCHABLE) {
    if (!(key in body)) continue
    if (key === 'slug' && !validSlug(body.slug)) {
      return { error: 'Invalid slug' }
    }
    // The two name columns are one fact (tenantRepository mirrors the write),
    // so a payload carrying both must not assign the column twice.
    if (key === 'band_name' && 'display_name' in body) continue
    fields.push(`${key} = $${idx++}`)
    values.push(body[key])
  }
  return { fields, values }
}

// The accounting country of a new tenant. Required, never defaulted: a silently
// Dutch tenant is a wrong accounting jurisdiction, not a convenient default, and
// the country is immutable afterwards. Shared by BOTH creation paths
// (self-service and super-admin) so the two can't drift.
// Returns { error: '<code>' } | { countryCode }.
export function parseTenantCountryCode(body) {
  const raw = body?.country_code
  if (raw === null || raw === undefined || raw === '') {
    return { error: 'country_code_required' }
  }
  const countryCode = normalizeVatCountry(raw)
  if (!countryCode) return { error: 'invalid_country_code' }
  return { countryCode }
}

// Resolves the seed-admin user id for a new tenant. Absent field → the creating
// super admin (fallbackUserId). Explicit null → no admin. Anything else must be a
// positive integer. Returns { error } | { adminUserId } (adminUserId may be null).
export function resolveAdminUserId(body, fallbackUserId) {
  const hasField = body && Object.hasOwn(body, 'adminUserId')
  let adminUserId = hasField ? body.adminUserId : fallbackUserId
  if (adminUserId !== null && adminUserId !== undefined) {
    adminUserId = Number(adminUserId)
    if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
      return { error: 'adminUserId must be an integer or null' }
    }
  }
  return { adminUserId: adminUserId ?? null }
}
