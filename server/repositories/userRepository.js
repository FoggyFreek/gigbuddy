// Data-access helpers for tenant memberships (the "users" admin view) and the
// band-member link. Each query takes an `executor` (a pool or transaction
// client) so callers control transactions. Every query is scoped by tenant_id.

const MEMBERSHIP_COLUMNS = `m.id              AS membership_id,
        m.role,
        m.status,
        m.created_at      AS membership_created_at,
        m.approved_at,
        u.id               AS user_id,
        u.email,
        u.name,
        u.picture_url,
        u.is_super_admin,
        bm.id              AS band_member_id`

export async function listMemberships(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${MEMBERSHIP_COLUMNS}
       FROM memberships m
       JOIN users u            ON u.id = m.user_id
       LEFT JOIN band_members bm
         ON bm.user_id = u.id AND bm.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1
      ORDER BY
        CASE m.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        m.created_at`,
    [tenantId],
  )
  return rows
}

export async function readMembershipRow(executor, tenantId, userId) {
  const { rows } = await executor.query(
    `SELECT ${MEMBERSHIP_COLUMNS}
       FROM memberships m
       JOIN users u            ON u.id = m.user_id
       LEFT JOIN band_members bm
         ON bm.user_id = u.id AND bm.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.user_id = $2`,
    [tenantId, userId],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments to a membership, appending the WHERE bindings.
export async function updateMembership(executor, tenantId, userId, sets, values) {
  const whereIdx = values.length + 1
  await executor.query(
    `UPDATE memberships SET ${sets.join(', ')}
      WHERE tenant_id = $${whereIdx} AND user_id = $${whereIdx + 1}`,
    [...values, tenantId, userId],
  )
}

export async function deleteMembership(executor, tenantId, userId) {
  await executor.query(
    'DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  )
}

// ---------- band-member link ----------

// Locks the target band member row to serialize concurrent reassignments.
// Returns the row (or null if it doesn't belong to the tenant).
export async function lockBandMember(executor, bandMemberId, tenantId) {
  const { rows } = await executor.query(
    'SELECT user_id FROM band_members WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [bandMemberId, tenantId],
  )
  return rows[0] || null
}

export async function clearUserBandMember(executor, userId, tenantId) {
  await executor.query(
    'UPDATE band_members SET user_id = NULL WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
}

export async function assignBandMember(executor, userId, bandMemberId, tenantId) {
  await executor.query(
    'UPDATE band_members SET user_id = $1 WHERE id = $2 AND tenant_id = $3',
    [userId, bandMemberId, tenantId],
  )
}
