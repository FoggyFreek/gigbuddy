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

// ALL tenants a user owns — archived included — id-ordered so multi-tenant
// lock acquisition (downgrade precheck) is deterministic and can't deadlock.
// The downgrade blockers and the downgrade purge deliberately cover archived
// tenants: an archived band can be unarchived later, so it must fit the
// target plan's per-tenant limits and its gated data (and integration
// secrets) is subject to the same purge promise. Only the band cap itself
// counts active tenants (archiving is the documented way to satisfy it).
export async function listOwnedTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT id, band_name, archived_at FROM tenants
      WHERE owner_user_id = $1
      ORDER BY id ASC`,
    [userId],
  )
  return rows
}

// Current storage meter reading (0 for a tenant without a stats row yet).
export async function getTenantStorageBytes(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(storage_bytes, 0)::bigint AS storage_bytes FROM tenant_statistics WHERE tenant_id = $1',
    [tenantId],
  )
  return Number(rows[0]?.storage_bytes ?? 0)
}
