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

// Lightweight read of just the tenant's VAT country, used by finance services
// to resolve the allowed VAT rates for a tenant without loading the full row.
// Returns the stored code (defaulted to 'nl' at the column level).
export async function fetchTenantVatCountry(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT vat_country FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.vat_country ?? null
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

export async function insertTenant(executor, slug, bandName, createdByUserId, ownerUserId = null) {
  const { rows } = await executor.query(
    `INSERT INTO tenants (slug, band_name, created_by_user_id, owner_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING ${tenantSafeProjection()}`,
    [slug, bandName, createdByUserId, ownerUserId],
  )
  return rows[0]
}

// Insert variant for server-generated slugs: a slug collision returns null
// instead of raising 23505 (which would abort the caller's transaction), so
// the service can try the next dedupe suffix within the same transaction.
export async function insertTenantIfSlugFree(executor, slug, bandName, createdByUserId, ownerUserId = null) {
  const { rows } = await executor.query(
    `INSERT INTO tenants (slug, band_name, created_by_user_id, owner_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO NOTHING
     RETURNING ${tenantSafeProjection()}`,
    [slug, bandName, createdByUserId, ownerUserId],
  )
  return rows[0] ?? null
}

// Tenants a user owns (self-service management list), newest first.
export async function listOwnedTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection('t')},
            (SELECT COUNT(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.status = 'approved') AS member_count
       FROM tenants t
      WHERE t.owner_user_id = $1
      ORDER BY t.created_at DESC, t.id DESC`,
    [userId],
  )
  return rows
}

// Owner-scoped fetch — non-owners get null (surfaces as 404, not 403).
export async function fetchOwnedTenant(executor, tenantId, ownerUserId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection()} FROM tenants WHERE id = $1 AND owner_user_id = $2`,
    [tenantId, ownerUserId],
  )
  return rows[0] || null
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

export async function fetchMembershipStatus(executor, userId, tenantId) {
  const { rows } = await executor.query(
    'SELECT status FROM memberships WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]?.status ?? null
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

// Demotes a tenant_admin back to a plain contributor. Returns true when a row was updated.
export async function demoteAdminToContributor(executor, tenantId, userId) {
  const { rowCount } = await executor.query(
    `UPDATE memberships SET role = 'contributor'
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

export async function fetchTenantForDeletion(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, slug, archived_at FROM tenants WHERE id = $1 FOR UPDATE',
    [tenantId],
  )
  return rows[0] || null
}

// Capture all database-referenced object keys before the cascading tenant
// delete. Most are modern prefixed keys; including them also covers the
// read-only unprefixed keys left by the original single-tenant deployment.
export async function fetchTenantAssetKeys(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT key FROM (
       SELECT logo_path AS key FROM tenants WHERE id = $1
       UNION ALL SELECT banner_path FROM tenants WHERE id = $1
       UNION ALL SELECT avatar_path FROM tenants WHERE id = $1
       UNION ALL SELECT logo_dark_path FROM tenants WHERE id = $1
       UNION ALL SELECT memory_image_path FROM tenants WHERE id = $1
       UNION ALL SELECT banner_path FROM gigs WHERE tenant_id = $1
       UNION ALL SELECT object_key FROM share_photos WHERE tenant_id = $1
       UNION ALL SELECT object_key FROM gig_attachments WHERE tenant_id = $1
       UNION ALL SELECT pdf_path FROM invoices WHERE tenant_id = $1
       UNION ALL SELECT custom_logo_path FROM invoices WHERE tenant_id = $1
       UNION ALL SELECT object_key FROM song_documents WHERE tenant_id = $1
       UNION ALL SELECT object_key FROM song_recordings WHERE tenant_id = $1
       UNION ALL SELECT object_key FROM purchase_attachments WHERE tenant_id = $1
     ) assets
     WHERE key IS NOT NULL`,
    [tenantId],
  )
  return [...new Set(rows.map(({ key }) => key))]
}

export async function deleteTenantRow(executor, tenantId) {
  const { rowCount } = await executor.query('DELETE FROM tenants WHERE id = $1', [tenantId])
  return rowCount > 0
}
