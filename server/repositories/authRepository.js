// Data-access helpers for authentication / session bootstrap. Each query takes
// an `executor` (a pool or transaction client) so callers control transactions.
// Users and memberships are global; tenant scoping happens via memberships.

export async function fetchUserById(executor, userId) {
  const { rows } = await executor.query('SELECT * FROM users WHERE id = $1', [userId])
  return rows[0] || null
}

// Pending + approved memberships in non-archived tenants, for the /me payload.
export async function listMembershipsForMe(executor, userId) {
  const { rows } = await executor.query(
    `SELECT m.tenant_id, m.role, m.status, t.slug AS tenant_slug, t.band_name AS tenant_name
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
       AND m.status IN ('pending', 'approved')
       AND t.archived_at IS NULL
     ORDER BY m.tenant_id ASC`,
    [userId],
  )
  return rows
}

export async function getBandMemberId(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.id ?? null
}

export async function anySuperAdminExists(executor) {
  const { rowCount } = await executor.query('SELECT 1 FROM users WHERE is_super_admin = TRUE LIMIT 1')
  return rowCount > 0
}

// Upsert (by google_sub) the signing-in user, refreshing profile fields and
// last_login_at. is_super_admin/status only apply on first insert.
export async function upsertUserFromClaims(executor, claims, isSuperAdmin, status) {
  const { rows } = await executor.query(
    `INSERT INTO users (google_sub, email, name, picture_url, is_super_admin, status, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       picture_url = EXCLUDED.picture_url,
       last_login_at = NOW()
     RETURNING *`,
    [claims.sub, claims.email, claims.name, claims.picture, isSuperAdmin, status],
  )
  return rows[0]
}

// Grants the bootstrap admin an approved tenant_admin membership in the seed
// tenant (id 1), preserving an existing approved_at.
export async function upsertSeedAdminMembership(executor, userId) {
  await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, 1, 'tenant_admin', 'approved', NOW())
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET
       role = 'tenant_admin',
       status = 'approved',
       approved_at = COALESCE(memberships.approved_at, NOW())`,
    [userId],
  )
}

export async function firstApprovedTenantId(executor, userId) {
  const { rows } = await executor.query(
    `SELECT m.tenant_id
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.status = 'approved'
        AND t.archived_at IS NULL
      ORDER BY m.tenant_id ASC
      LIMIT 1`,
    [userId],
  )
  return rows[0]?.tenant_id ?? null
}

export async function isApprovedMember(executor, userId, tenantId) {
  const { rowCount } = await executor.query(
    `SELECT 1
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.tenant_id = $2
        AND m.status = 'approved'
        AND t.archived_at IS NULL`,
    [userId, tenantId],
  )
  return rowCount > 0
}
