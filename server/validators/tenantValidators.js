// Input parsing and validation for tenant routes. No DB access here.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function validSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug)
}

export const PATCHABLE = [
  'slug',
  'band_name',
  'bio',
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
    fields.push(`${key} = $${idx++}`)
    values.push(body[key])
  }
  return { fields, values }
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
