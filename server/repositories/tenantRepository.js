// Data-access helpers for tenants and their memberships. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.
//
// Tenants are global super-admin-managed resources (no tenant_id scoping); the
// memberships table joins them to users.
import { tenantSafeProjection } from './tenantSafeProjection.js'

export async function listTenantsWithMemberCount(executor) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection('t')},
            (SELECT COUNT(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.status = 'approved') AS member_count
       FROM tenants t
      ORDER BY t.id`,
  )
  return rows
}

export async function fetchTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection()} FROM tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchTenantArchiveState(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, archived_at FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0] || null
}

export async function userExists(executor, userId) {
  const { rowCount } = await executor.query('SELECT 1 FROM users WHERE id = $1', [userId])
  return rowCount > 0
}

export async function insertTenant(executor, slug, bandName, createdByUserId) {
  const { rows } = await executor.query(
    `INSERT INTO tenants (slug, band_name, created_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING ${tenantSafeProjection()}`,
    [slug, bandName, createdByUserId],
  )
  return rows[0]
}

// Ensures the new tenant always has a stats row (reads also COALESCE as a
// backstop, but this keeps the row present from creation).
export async function ensureTenantStatistics(executor, tenantId) {
  await executor.query(
    'INSERT INTO tenant_statistics (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [tenantId],
  )
}

// Plain insert of an approved tenant_admin membership, used during tenant
// creation when the seed admin can't already have a membership.
export async function insertTenantAdminMembership(executor, userId, tenantId, approvedByUserId) {
  await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3)`,
    [userId, tenantId, approvedByUserId],
  )
}

// Applies prebuilt SET fragments to a tenant, appending updated_at and the WHERE
// binding. Returns the updated row or null.
export async function updateTenantFields(executor, tenantId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE tenants SET ${assignments.join(', ')} WHERE id = $${whereIdx}
     RETURNING ${tenantSafeProjection()}`,
    [...values, tenantId],
  )
  return rows[0] || null
}

// Upsert an approved tenant_admin membership (grant or promote).
export async function upsertTenantAdmin(executor, userId, tenantId, approvedByUserId) {
  const { rows } = await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3)
     ON CONFLICT (user_id, tenant_id)
     DO UPDATE SET role = 'tenant_admin',
                   status = 'approved',
                   approved_at = NOW(),
                   approved_by_user_id = EXCLUDED.approved_by_user_id
     RETURNING *`,
    [userId, tenantId, approvedByUserId],
  )
  return rows[0]
}

// Upsert an approved membership at the given role (super-admin direct grant).
export async function upsertMembership(executor, userId, tenantId, role, approvedByUserId) {
  const { rows } = await executor.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
     VALUES ($1, $2, $3, 'approved', NOW(), $4)
     ON CONFLICT (user_id, tenant_id)
     DO UPDATE SET role = EXCLUDED.role,
                   status = 'approved',
                   approved_at = NOW(),
                   approved_by_user_id = EXCLUDED.approved_by_user_id
     RETURNING *`,
    [userId, tenantId, role, approvedByUserId],
  )
  return rows[0]
}

// Demotes a tenant_admin back to member. Returns true when a row was updated.
export async function demoteAdminToMember(executor, tenantId, userId) {
  const { rowCount } = await executor.query(
    `UPDATE memberships SET role = 'member'
      WHERE tenant_id = $1 AND user_id = $2 AND role = 'tenant_admin'`,
    [tenantId, userId],
  )
  return rowCount > 0
}

export async function setTenantArchived(executor, tenantId, archived) {
  const { rows } = await executor.query(
    `UPDATE tenants SET archived_at = ${archived ? 'NOW()' : 'NULL'}, updated_at = NOW()
      WHERE id = $1 RETURNING ${tenantSafeProjection()}`,
    [tenantId],
  )
  return rows[0] || null
}
