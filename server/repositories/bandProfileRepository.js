// Data access for global band profiles.
//
// These are NOT tenant-scoped reads: a band that is not a gigbuddy customer
// belongs to nobody, and every musician who plays in it needs to find the same
// row. That is the point of the table.
//
// What that costs is care about what is selected. A profile carries two ids
// that must never leave the server for a non-admin caller — claimed_by_tenant_id
// and created_by_user_id — so the shaping in bandProfileService is not
// cosmetic. The queries here return raw rows; nothing outside that service may
// serialize one.
import { discoverableSql } from './bandDirectoryRepository.js'

// Claim state is derived, never stored: claimed_by_tenant_id and the claim rows
// are the only facts, so a deleted band tenant releases its profile through the
// foreign keys alone with no code to remember. This expression is the single
// owner of that derivation.
const STATUS_SQL = `
  CASE
    WHEN bp.claimed_by_tenant_id IS NOT NULL THEN 'claimed'
    WHEN EXISTS (
      SELECT 1 FROM band_profile_claims c
       WHERE c.band_profile_id = bp.id AND c.status = 'pending'
    ) THEN 'pending_claim'
    ELSE 'claimable'
  END AS status`

// The claiming tenant's identity is disclosed ONLY when that tenant is
// discoverable. Its id is the input to the join-request and avatar endpoints, so
// leaking it for an invite-only band would disclose the existence of a private
// tenant. `claimed` stays true either way — the profile name was already public,
// so "this band is on gigbuddy now" reveals nothing new.
// Exported so the My Bands read can nest a profile without restating the
// disclosure rule — a second copy is how a private tenant starts leaking.
export const CLAIMED_TENANT_JOIN = `
  LEFT JOIN tenants ct
    ON ct.id = bp.claimed_by_tenant_id AND ${discoverableSql('ct')}`

const CLAIMED_TENANT_SQL = `
  CASE WHEN ct.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', ct.id, 'slug', ct.slug, 'displayName', ct.display_name, 'logoPath', ct.logo_path
  ) END AS claimed_tenant`

export const PROFILE_PROJECTION = `
  bp.id, bp.name, bp.country_code, bp.spotify_url, bp.website_url, bp.contact_email,
  bp.created_by_user_id, bp.claimed_by_tenant_id, bp.created_at,
  (bp.claimed_by_tenant_id IS NOT NULL) AS claimed,
  ${STATUS_SQL},
  ${CLAIMED_TENANT_SQL}`

// Name substring plus an optional exact website-key match. The website match is
// advisory — it is surfaced as a suggestion, never enforced — so it widens the
// result set rather than filtering it, and sorts first because an exact link
// match is a far stronger signal than a name fragment.
export async function searchBandProfiles(executor, { query, websiteKey, limit }) {
  const { rows } = await executor.query(
    `SELECT ${PROFILE_PROJECTION},
            ($2::text IS NOT NULL AND bp.website_key = $2) AS website_match
       FROM band_profiles bp
       ${CLAIMED_TENANT_JOIN}
      WHERE ($1::text IS NOT NULL AND bp.name ILIKE '%' || $1 || '%')
         OR ($2::text IS NOT NULL AND bp.website_key = $2)
      ORDER BY
        CASE WHEN $2::text IS NOT NULL AND bp.website_key = $2 THEN 0 ELSE 1 END,
        CASE WHEN $1::text IS NOT NULL AND lower(bp.name) = lower($1) THEN 0 ELSE 1 END,
        lower(bp.name) ASC, bp.id ASC
      LIMIT $3`,
    [query, websiteKey, limit],
  )
  return rows
}

export async function fetchBandProfile(executor, profileId) {
  const { rows } = await executor.query(
    `SELECT ${PROFILE_PROJECTION}
       FROM band_profiles bp
       ${CLAIMED_TENANT_JOIN}
      WHERE bp.id = $1`,
    [profileId],
  )
  return rows[0] ?? null
}

// Super-admin table of profiles that have not been claimed by a tenant yet.
// A pending claim does not make a profile claimed: that state is derived only
// from claimed_by_tenant_id. My Bands rows are the current profile holders and
// therefore the member count shown to the reviewer.
export async function listUnclaimedBandProfiles(executor, { limit, cursor }) {
  const params = [limit]
  let cursorClause = ''
  if (cursor) {
    params.push(cursor.at, cursor.id)
    cursorClause = `WHERE (cursor_at, id) < ($2, $3)`
  }

  const { rows } = await executor.query(
    `WITH matching AS (
       SELECT bp.id, bp.name, bp.created_at,
              date_trunc('milliseconds', bp.created_at) AS cursor_at,
              COUNT(mb.id)::int AS member_count
         FROM band_profiles bp
         LEFT JOIN my_bands mb ON mb.band_profile_id = bp.id
        WHERE bp.claimed_by_tenant_id IS NULL
        GROUP BY bp.id, bp.name, bp.created_at
     ), page AS (
       SELECT * FROM matching
        ${cursorClause}
        ORDER BY cursor_at DESC, id DESC
        LIMIT $1
     ), totals AS (
       SELECT COUNT(*)::int AS total FROM matching
     )
     SELECT page.id, page.name, page.created_at, page.cursor_at,
            page.member_count, totals.total
       FROM totals
       LEFT JOIN page ON TRUE
      ORDER BY page.cursor_at DESC NULLS LAST, page.id DESC NULLS LAST`,
    params,
  )

  const total = rows[0]?.total ?? 0
  return {
    items: rows
      .filter((row) => row.id !== null)
      .map(({ total: _total, ...row }) => row),
    total,
  }
}

// Takes the profile row lock. band_profiles is the parent in this feature's
// lock order (tenants -> band_profiles -> claims/my_bands/events), so anything
// that reads derived claim state and then writes takes this first.
//
// Returns the raw stored columns — including the dedup keys the projection above
// deliberately omits — because the callers are merge-and-validate paths, not
// serialization paths.
export async function lockBandProfile(executor, profileId) {
  const { rows } = await executor.query(
    `SELECT id, name, country_code, spotify_url, spotify_artist_id,
            website_url, website_key, contact_email,
            created_by_user_id, claimed_by_tenant_id
       FROM band_profiles WHERE id = $1 FOR UPDATE`,
    [profileId],
  )
  return rows[0] ?? null
}

// Locks several profiles at once, ascending by id so concurrent callers touching
// overlapping sets cannot deadlock against each other.
export async function lockBandProfiles(executor, profileIds) {
  if (profileIds.length === 0) return []
  const { rows } = await executor.query(
    `SELECT id, claimed_by_tenant_id FROM band_profiles
      WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [profileIds],
  )
  return rows
}

export async function insertBandProfile(executor, profile, createdByUserId) {
  const { rows } = await executor.query(
    `INSERT INTO band_profiles
       (name, country_code, spotify_url, spotify_artist_id,
        website_url, website_key, contact_email, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      profile.name, profile.country_code, profile.spotify_url, profile.spotify_artist_id,
      profile.website_url, profile.website_key, profile.contact_email, createdByUserId,
    ],
  )
  return rows[0].id
}

const UPDATABLE_COLUMNS = [
  'name', 'country_code', 'spotify_url', 'spotify_artist_id',
  'website_url', 'website_key', 'contact_email',
]

// Applies a validated patch. The column whitelist is here as well as in the
// validator because this function takes an object, and an object is exactly the
// shape a future caller could build carelessly.
export async function updateBandProfile(executor, profileId, patch) {
  const columns = UPDATABLE_COLUMNS.filter((column) => Object.hasOwn(patch, column))
  if (columns.length === 0) return

  const sets = columns.map((column, index) => `${column} = $${index + 2}`)
  await executor.query(
    `UPDATE band_profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [profileId, ...columns.map((column) => patch[column])],
  )
}

// The cheap half of the derived status, for callers that already hold the
// locked row and only need to know whether it is frozen.
export async function hasPendingClaim(executor, profileId) {
  const { rowCount } = await executor.query(
    `SELECT 1 FROM band_profile_claims
      WHERE band_profile_id = $1 AND status = 'pending'`,
    [profileId],
  )
  return rowCount > 0
}

export async function findBySpotifyArtistId(executor, artistId) {
  if (!artistId) return null
  const { rows } = await executor.query(
    'SELECT id FROM band_profiles WHERE spotify_artist_id = $1',
    [artistId],
  )
  return rows[0]?.id ?? null
}

export async function countProfilesCreatedByUser(executor, userId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM band_profiles WHERE created_by_user_id = $1',
    [userId],
  )
  return rows[0].count
}

// Terminal deletion. A profile exists only while somebody holds it or a claim
// is live; the moment neither is true it is gone, so the table cannot silt up
// with rows nobody can reach.
//
// One statement, so it is atomic on its own; callers still take the profile row
// lock first, because they have already read the state they are acting on.
export async function deleteBandProfileIfAbandoned(executor, profileId) {
  const { rowCount } = await executor.query(
    `DELETE FROM band_profiles bp
      WHERE bp.id = $1
        AND NOT EXISTS (SELECT 1 FROM my_bands mb WHERE mb.band_profile_id = bp.id)
        AND NOT EXISTS (
          SELECT 1 FROM band_profile_claims c
           WHERE c.band_profile_id = bp.id AND c.status = 'pending'
        )`,
    [profileId],
  )
  return rowCount > 0
}

export async function setClaimedTenant(executor, profileId, tenantId) {
  await executor.query(
    'UPDATE band_profiles SET claimed_by_tenant_id = $2, updated_at = NOW() WHERE id = $1',
    [profileId, tenantId],
  )
}
