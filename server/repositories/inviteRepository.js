// Data-access helpers for tenant invites and the memberships they create. Each
// query takes an `executor` (a pool or transaction client) so callers control
// transactions.

export async function listInvitesWithNames(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT i.*,
            cu.name AS created_by_name,
            uu.name AS used_by_name
       FROM tenant_invites i
       LEFT JOIN users cu ON cu.id = i.created_by_user_id
       LEFT JOIN users uu ON uu.id = i.used_by_user_id
      WHERE i.tenant_id = $1
      ORDER BY i.created_at DESC`,
    [tenantId],
  )
  return rows
}

export async function insertInvite(executor, code, tenantId, role, createdByUserId, expiresAt) {
  const { rows } = await executor.query(
    `INSERT INTO tenant_invites (code, tenant_id, role, created_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [code, tenantId, role, createdByUserId, expiresAt],
  )
  return rows[0]
}

// Revokes an unused invite by expiring it now. Returns true when a row matched.
export async function revokeInvite(executor, inviteId, tenantId) {
  const { rowCount } = await executor.query(
    `UPDATE tenant_invites
        SET expires_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND used_at IS NULL`,
    [inviteId, tenantId],
  )
  return rowCount > 0
}

// Atomically claims an unused invite for a user, returning the invite joined to
// its tenant (slug/name/archived state), or null when no unused invite matched.
export async function claimInvite(executor, code, userId) {
  const { rows } = await executor.query(
    `UPDATE tenant_invites i
        SET used_at = NOW(),
            used_by_user_id = $2
       FROM tenants t
      WHERE i.code = $1
        AND i.used_at IS NULL
        AND t.id = i.tenant_id
      RETURNING i.*, t.slug AS tenant_slug, t.band_name AS tenant_name, t.archived_at AS tenant_archived_at`,
    [code, userId],
  )
  return rows[0] || null
}

export async function inviteExists(executor, code) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM tenant_invites WHERE code = $1',
    [code],
  )
  return rowCount > 0
}

export async function getMembership(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, status, role FROM memberships WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0] || null
}

export async function insertPendingMembership(executor, userId, tenantId, role) {
  await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status)
     VALUES ($1, $2, $3, 'pending')`,
    [userId, tenantId, role],
  )
}
