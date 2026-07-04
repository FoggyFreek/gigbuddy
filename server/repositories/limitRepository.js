// Data-access helpers for numeric limit enforcement (member and band caps).
// The lock functions take FOR UPDATE row locks so concurrent capacity-
// increasing writes serialize on the same row and can't both pass a cap check.

// Locks the tenant row and returns its owner, or undefined when the tenant
// doesn't exist. (null = ownerless tenant — enforcement skipped.)
export async function lockTenantForCapCheck(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT owner_user_id FROM tenants WHERE id = $1 FOR UPDATE',
    [tenantId],
  )
  return rows.length ? rows[0].owner_user_id : undefined
}

// Locks the user row (serializes that user's tenant create/unarchive).
export async function lockUserForCapCheck(executor, userId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  )
  return rowCount > 0
}

export async function countRosterMembers(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM band_members WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0].count
}

export async function countApprovedMemberships(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM memberships
     WHERE tenant_id = $1 AND status = 'approved'`,
    [tenantId],
  )
  return rows[0].count
}

// Active (non-archived) tenants a user owns — the band cap counter.
export async function countActiveOwnedTenants(executor, userId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS count FROM tenants WHERE owner_user_id = $1 AND archived_at IS NULL',
    [userId],
  )
  return rows[0].count
}
