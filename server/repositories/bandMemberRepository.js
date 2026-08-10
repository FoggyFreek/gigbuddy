// Data-access helpers for band members. Each query takes an `executor` (a pool
// or transaction client) so callers control transactions. Every query is scoped
// by tenant_id.

export async function listBandMembers(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT bm.id, bm.tenant_id, bm.name, bm.roles, bm.color, bm.sort_order,
            bm.position, bm.created_at, bm.user_id,
            COALESCE(m.availability_managed_by_band, FALSE) AS availability_managed_by_band
       FROM band_members bm
       LEFT JOIN memberships m
         ON m.tenant_id = bm.tenant_id AND m.user_id = bm.user_id
        AND m.status = 'approved'
      WHERE bm.tenant_id = $1 AND bm.deleted_at IS NULL
      ORDER BY bm.sort_order ASC, bm.id ASC`,
    [tenantId],
  )
  return rows
}

export async function bandMemberExistsInTenant(executor, memberId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM band_members WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [memberId, tenantId],
  )
  return rowCount > 0
}

// The account a roster row is linked to, or null for a dep/CRM-only member.
// This is the bridge availability writes use to decide whether a slot belongs
// to a person (user-level) or to this band alone.
export async function bandMemberUserId(executor, memberId, tenantId) {
  const { rows } = await executor.query(
    'SELECT user_id FROM band_members WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [memberId, tenantId],
  )
  return rows[0]?.user_id ?? null
}

// The inverse of bandMemberUserId: the roster row a signed-in user occupies in
// this tenant, or null when they have none (a member without a linked account,
// or a user reading a tenant they only just joined).
export async function getBandMemberIdForUser(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

export async function nextSortOrder(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM band_members WHERE tenant_id = $1 AND deleted_at IS NULL',
    [tenantId],
  )
  return rows[0].next
}

export async function insertBandMember(executor, tenantId, { name, roles, color, sortOrder, position }) {
  const { rows } = await executor.query(
    `INSERT INTO band_members (tenant_id, name, roles, color, sort_order, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, name, roles, color, sort_order, position,
               created_at, user_id`,
    [tenantId, name, roles, color, sortOrder, position],
  )
  return rows[0]
}

export async function updateBandMemberFields(executor, tenantId, memberId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE band_members SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} AND deleted_at IS NULL RETURNING *`,
    [...values, memberId, tenantId],
  )
  return rows[0] || null
}

export async function fetchBandMemberForUpdate(executor, memberId, tenantId) {
  const { rows } = await executor.query(
    `SELECT * FROM band_members
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [memberId, tenantId],
  )
  return rows[0] ?? null
}

export async function syncLeadIntoCurrentEvents(executor, tenantId, memberId, actorUserId = null) {
  await executor.query(
    `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, updated_by_user_id)
     SELECT $1, id, $2, $3 FROM gigs
      WHERE tenant_id = $1 AND event_date >= CURRENT_DATE
     ON CONFLICT (gig_id, band_member_id) DO NOTHING`,
    [tenantId, memberId, actorUserId],
  )
  await executor.query(
    `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id)
     SELECT $1, id, $2 FROM rehearsals
      WHERE tenant_id = $1 AND proposed_date >= CURRENT_DATE
     ON CONFLICT (rehearsal_id, band_member_id) DO NOTHING`,
    [tenantId, memberId],
  )
  await executor.query(
    `UPDATE rehearsals r SET status = 'option', updated_at = NOW()
      WHERE r.tenant_id = $1 AND r.proposed_date >= CURRENT_DATE AND r.status = 'planned'
        AND EXISTS (
          SELECT 1 FROM rehearsal_participants rp
           WHERE rp.tenant_id = r.tenant_id AND rp.rehearsal_id = r.id
             AND rp.vote IS DISTINCT FROM 'yes'
        )`,
    [tenantId],
  )
  await executor.query(
    `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
     SELECT $1, id, $2 FROM band_events
      WHERE tenant_id = $1 AND end_date >= CURRENT_DATE
     ON CONFLICT (band_event_id, band_member_id) DO NOTHING`,
    [tenantId, memberId],
  )
}

export async function removeMemberFromCurrentEvents(executor, tenantId, memberId) {
  await executor.query(
    `DELETE FROM gig_participants gp USING gigs g
      WHERE gp.gig_id = g.id AND gp.tenant_id = $1 AND g.tenant_id = $1
        AND gp.band_member_id = $2 AND g.event_date >= CURRENT_DATE`,
    [tenantId, memberId],
  )
  await executor.query(
    `DELETE FROM rehearsal_participants rp USING rehearsals r
      WHERE rp.rehearsal_id = r.id AND rp.tenant_id = $1 AND r.tenant_id = $1
        AND rp.band_member_id = $2 AND r.proposed_date >= CURRENT_DATE`,
    [tenantId, memberId],
  )
  await executor.query(
    `DELETE FROM band_event_participants bep USING band_events e
      WHERE bep.band_event_id = e.id AND bep.tenant_id = $1 AND e.tenant_id = $1
        AND bep.band_member_id = $2 AND e.end_date >= CURRENT_DATE`,
    [tenantId, memberId],
  )
}

export async function deleteBandMember(executor, memberId, tenantId) {
  const { rowCount } = await executor.query(
    `UPDATE band_members SET deleted_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [memberId, tenantId],
  )
  return rowCount > 0
}
