// Data access for band-profile claims: a band tenant asking to be recognised as
// the owner of a global profile, reviewed by a super admin.
//
// A decided claim is the audit record of that decision and outlives the profile
// it points at (band_profile_id is ON DELETE SET NULL, with band_profile_name as
// the snapshot), so nothing here may assume the profile still exists.

const CLAIM_COLUMNS = `c.id, c.band_profile_id, c.band_profile_name, c.tenant_id,
  c.status, c.message, c.decision_reason, c.created_at, c.decided_at`

// The name is snapshotted at claim time rather than joined, so the row still
// reads after the profile it referred to has been deleted.
export async function insertClaim(executor, { profileId, profileName, tenantId, userId, message }) {
  const { rows } = await executor.query(
    `INSERT INTO band_profile_claims
       (band_profile_id, band_profile_name, tenant_id, requested_by_user_id, message, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id`,
    [profileId, profileName, tenantId, userId, message],
  )
  return rows[0].id
}

// A tenant may hold only one live claim (partial unique index), so "the
// tenant's claim" is unambiguous. Decided claims are kept as history, and the
// most recent one is what the band should see.
export async function fetchClaimForTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${CLAIM_COLUMNS} FROM band_profile_claims c
      WHERE c.tenant_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 1`,
    [tenantId],
  )
  return rows[0] ?? null
}

// The full row, for shaping a response. lockClaim below reads only what the
// decision logic needs, so it is not a substitute for this.
export async function fetchClaim(executor, claimId) {
  const { rows } = await executor.query(
    `SELECT ${CLAIM_COLUMNS} FROM band_profile_claims c WHERE c.id = $1`,
    [claimId],
  )
  return rows[0] ?? null
}

export async function lockClaim(executor, claimId) {
  const { rows } = await executor.query(
    `SELECT id, band_profile_id, band_profile_name, tenant_id, status
       FROM band_profile_claims WHERE id = $1 FOR UPDATE`,
    [claimId],
  )
  return rows[0] ?? null
}

// Read WITHOUT a lock, purely to learn which rows the caller will need to lock
// in the global order (tenants -> band_profiles -> claims).
export async function peekClaimTargets(executor, claimId) {
  const { rows } = await executor.query(
    'SELECT tenant_id, band_profile_id FROM band_profile_claims WHERE id = $1',
    [claimId],
  )
  return rows[0] ?? null
}

export async function deletePendingClaim(executor, claimId, tenantId) {
  const { rowCount } = await executor.query(
    `DELETE FROM band_profile_claims
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [claimId, tenantId],
  )
  return rowCount > 0
}

export async function decideClaim(executor, claimId, { status, reason, decidedByUserId }) {
  await executor.query(
    `UPDATE band_profile_claims
        SET status = $2, decision_reason = $3, decided_by_user_id = $4, decided_at = NOW()
      WHERE id = $1`,
    [claimId, status, reason, decidedByUserId],
  )
}

// The admin queue. Ordered by (created_at, id) DESC to match the timestamp
// cursor: claims are TIMESTAMPTZ-keyed and several land on one day, so the
// day-granular cursor used by the planning feeds would skip or repeat rows.
export async function listClaims(executor, { status, limit, cursor }) {
  const params = [status, limit]
  let cursorClause = ''
  if (cursor) {
    params.push(cursor.at, cursor.id)
    cursorClause = `AND (c.created_at, c.id) < ($${params.length - 1}, $${params.length})`
  }
  const { rows } = await executor.query(
    `SELECT ${CLAIM_COLUMNS},
            t.slug AS tenant_slug, t.display_name AS tenant_display_name,
            t.kind AS tenant_kind, t.archived_at AS tenant_archived_at,
            t.instagram_handle AS tenant_instagram_handle,
            t.facebook_handle AS tenant_facebook_handle,
            t.tiktok_handle AS tenant_tiktok_handle,
            t.youtube_handle AS tenant_youtube_handle,
            t.spotify_handle AS tenant_spotify_handle,
            u.email AS requested_by_email, u.name AS requested_by_name,
            reviewer.email AS decided_by_email, reviewer.name AS decided_by_name,
            bp.country_code, bp.spotify_url, bp.website_url, bp.contact_email
       FROM band_profile_claims c
       JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN users u ON u.id = c.requested_by_user_id
       LEFT JOIN users reviewer ON reviewer.id = c.decided_by_user_id
       LEFT JOIN band_profiles bp ON bp.id = c.band_profile_id
      WHERE ($1::text IS NULL OR c.status = $1) ${cursorClause}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $2`,
    params,
  )
  return rows
}

// The owners of personal workspaces that currently hold a profile in My Bands,
// enriched with how each owner stands with the band making that claim. The
// claim page is bounded, and a profile has at most five holders, so this remains
// a small batch rather than an N+1 query per queue row.
export async function listProfileUsersForClaims(executor, claimIds) {
  if (claimIds.length === 0) return []
  const { rows } = await executor.query(
    `SELECT c.id AS claim_id,
            u.id AS user_id, u.name AS user_name, u.email AS user_email,
            m.status AS membership_status, m.role AS membership_role
       FROM band_profile_claims c
       JOIN my_bands mb ON mb.band_profile_id = c.band_profile_id
       JOIN tenants holder_t ON holder_t.id = mb.tenant_id AND holder_t.kind = 'personal'
       JOIN users u ON u.id = holder_t.owner_user_id
       LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = c.tenant_id
      WHERE c.id = ANY($1::int[])
      ORDER BY c.id, lower(COALESCE(NULLIF(u.name, ''), u.email)), u.id`,
    [claimIds],
  )
  return rows
}
