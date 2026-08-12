// Shared fixtures and assertions for the band-profile suites.
import { expect } from 'vitest'

export const ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb'
export const spotifyUrl = (id = ARTIST_ID) => `https://open.spotify.com/artist/${id}`

// Columns that must never reach a non-admin caller. claimed_by_tenant_id is the
// input to the join-request and avatar endpoints, so emitting it for a band that
// has not opted into discovery would disclose a private tenant's existence.
// created_by_user_id and the dedup keys are simply nobody's business.
const INTERNAL_COLUMNS = [
  'claimed_by_tenant_id', 'claimedByTenantId',
  'created_by_user_id', 'createdByUserId',
  'website_key', 'websiteKey',
  'spotify_artist_id', 'spotifyArtistId',
]

// Applied to EVERY non-admin surface that returns a profile, not just search:
// the leak class is "somebody spread a raw row", which can happen anywhere.
export function expectNoInternalFields(body) {
  const serialized = JSON.stringify(body)
  for (const column of INTERNAL_COLUMNS) {
    expect(serialized).not.toContain(column)
  }
}

// truncateAll RESTARTs every identity, so users, tenants and band profiles all
// begin at 1 and their ids collide numerically. That would make expectAbsentId
// pass or fail by coincidence rather than by behaviour, so profile ids are
// pushed into their own range first.
export const isolateProfileIds = (pool) =>
  pool.query('ALTER SEQUENCE band_profiles_id_seq RESTART WITH 5000')

// Stronger than the field check: proves a specific hidden tenant's id appears
// nowhere at all, in any field, however it might have been renamed.
export function expectAbsentId(body, id) {
  const found = []
  JSON.stringify(body, (key, value) => {
    if (value === id) found.push(key)
    return value
  })
  expect(found).toEqual([])
}

export async function insertProfile(pool, { createdBy, ...overrides } = {}) {
  const values = {
    name: 'Off Platform',
    country_code: 'nl',
    website_url: 'https://offplatform.example',
    website_key: 'offplatform.example',
    spotify_url: null,
    spotify_artist_id: null,
    contact_email: null,
    ...overrides,
  }
  const { rows } = await pool.query(
    `INSERT INTO band_profiles
       (name, country_code, website_url, website_key, spotify_url, spotify_artist_id,
        contact_email, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [values.name, values.country_code, values.website_url, values.website_key,
      values.spotify_url, values.spotify_artist_id, values.contact_email, createdBy ?? null],
  )
  return rows[0]
}

export async function insertPendingClaim(pool, profileId, tenantId, userId) {
  const { rows } = await pool.query(
    `INSERT INTO band_profile_claims
       (band_profile_id, band_profile_name, tenant_id, requested_by_user_id, status)
     SELECT $1, name, $2, $3, 'pending' FROM band_profiles WHERE id = $1
     RETURNING *`,
    [profileId, tenantId, userId ?? null],
  )
  return rows[0]
}

// The band directory's opt-in flag. A band that has not set it is invisible to
// non-members, and the profile payload must respect that.
export const makeDiscoverable = (pool, tenantId) =>
  pool.query(`UPDATE tenants SET join_policy = 'request' WHERE id = $1`, [tenantId])
