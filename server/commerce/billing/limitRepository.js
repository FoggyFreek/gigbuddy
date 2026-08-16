// Data-access helpers for numeric limit enforcement (member and band caps).
// The lock functions take FOR UPDATE row locks so concurrent capacity-
// increasing writes serialize on the same row and can't both pass a cap check.

// Locks the tenant row and returns { ownerUserId, kind }, or undefined when the
// tenant doesn't exist. (ownerUserId null = ownerless tenant — enforcement
// skipped.) The kind rides along so the caller can resolve entitlements without
// a second read: it selects which of the owner's subscriptions governs.
export async function lockTenantForCapCheck(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT owner_user_id, kind FROM tenants WHERE id = $1 FOR UPDATE',
    [tenantId],
  )
  return rows.length ? { ownerUserId: rows[0].owner_user_id, kind: rows[0].kind } : undefined
}

// The tenant-wide advisory lock every capacity-growing write takes (uploads via
// tenant statistics, purgeable-feature writes via withFeatureWriteGuard). The
// downgrade precheck must take the SAME key, or a member add or upload could
// slip past a check that is about to lower the limit.
export async function advisoryLockTenant(executor, tenantId) {
  await executor.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
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
    `SELECT COUNT(*)::int AS count FROM band_members
      WHERE tenant_id = $1 AND deleted_at IS NULL`,
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

// Active (non-archived) tenants a user owns — the band cap counter. A personal
// workspace is not one of your bands, so it never counts (and an artist plan
// with bands: 0 must not make the owner's own workspace a cap violation).
export async function countActiveOwnedTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM tenants
      WHERE owner_user_id = $1 AND archived_at IS NULL AND kind = 'band'`,
    [userId],
  )
  return rows[0].count
}

// Tenants a user owns — archived included — id-ordered so multi-tenant lock
// acquisition (downgrade precheck) is deterministic and can't deadlock.
// The downgrade blockers and the downgrade purge deliberately cover archived
// tenants: an archived band can be unarchived later, so it must fit the
// target plan's per-tenant limits and its gated data (and integration
// secrets) is subject to the same purge promise. Only the band cap itself
// counts active tenants (archiving is the documented way to satisfy it).
//
// `kinds` scopes the result to one ladder's tenants (tenantKindsForAudience):
// an artist downgrade must never inspect or purge a band, and vice versa. Null
// means every kind.
export async function listOwnedTenants(executor, userId, kinds = null) {
  const { rows } = await executor.query(
    `SELECT id, band_name, kind, archived_at FROM tenants
      WHERE owner_user_id = $1
        AND ($2::text[] IS NULL OR kind = ANY($2))
      ORDER BY id ASC`,
    [userId, kinds],
  )
  return rows
}

// Every counter the downgrade precheck measures, for a whole set of tenants in
// one round trip — the alternative is three queries per owned tenant inside a
// locked transaction. Correlated sub-selects (not joins) so a tenant with no
// members, no memberships or no statistics row still yields a row of zeroes,
// exactly like the singular helpers above.
export async function fetchTenantCapacityUsage(executor, tenantIds) {
  const { rows } = await executor.query(
    `SELECT t.id AS tenant_id,
            (SELECT COUNT(*)::int FROM band_members bm
              WHERE bm.tenant_id = t.id AND bm.deleted_at IS NULL) AS roster_members,
            (SELECT COUNT(*)::int FROM memberships m
              WHERE m.tenant_id = t.id AND m.status = 'approved') AS approved_members,
            COALESCE(ts.storage_bytes, 0)::bigint AS storage_bytes
       FROM tenants t
       LEFT JOIN tenant_statistics ts ON ts.tenant_id = t.id
      WHERE t.id = ANY($1::int[])`,
    [tenantIds],
  )
  return new Map(rows.map((r) => [r.tenant_id, {
    rosterMembers: r.roster_members,
    approvedMembers: r.approved_members,
    storageBytes: Number(r.storage_bytes),
  }]))
}
