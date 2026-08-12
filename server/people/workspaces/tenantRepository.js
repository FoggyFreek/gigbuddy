// Data-access helpers for tenants and their memberships. Each query takes an
// `executor` (a pool or transaction client) so callers control transactions.
//
// Tenants are global super-admin-managed resources (no tenant_id scoping); the
// memberships table joins them to users.
import { DEFAULT_TENANT_KIND } from '../../../shared/tenantKinds.js'
import { tenantSafeProjection } from '../../repositories/tenantSafeProjection.js'

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

// Locks the tenant row FOR UPDATE and returns the safe projection. Lets a
// read-validate-write sequence (the profile VAT/registration consistency check)
// run atomically so a concurrent PATCH can't slip an incompatible tax_id or
// kvk_number between the check and the write.
export async function lockTenantRow(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection()} FROM tenants WHERE id = $1 FOR UPDATE`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchTenantArchiveState(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, kind, archived_at FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0] || null
}

// Profile-picture lookup gated by the caller's pending or approved membership in
// that tenant — the generic /api/files route only authorizes against the *active*
// tenant, which would 404 the profile pictures of every other tenant the user can
// see. Returns null when the caller is not a current member (indistinguishable
// from "no profile picture": both 404).
export async function fetchTenantAvatarPathForMember(executor, userId, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.avatar_path
     FROM tenants t
     JOIN memberships m ON m.tenant_id = t.id AND m.user_id = $1
      AND m.status IN ('pending', 'approved')
     WHERE t.id = $2`,
    [userId, tenantId],
  )
  if (!rows[0]) return null
  return rows[0].avatar_path ?? null
}

export async function userExists(executor, userId) {
  const { rowCount } = await executor.query('SELECT 1 FROM users WHERE id = $1', [userId])
  return rowCount > 0
}

// The accounting country belongs to tenant_accounting_profiles.country_code,
// which the caller inserts in the same transaction.
//
// band_name and display_name hold the same fact while the kind-neutral rename
// is in flight; this repository is the only writer, so it is where they are
// kept in sync ($2 fills both).
const TENANT_INSERT_COLUMNS = 'slug, band_name, display_name, kind, created_by_user_id, owner_user_id'

function insertValues({ slug, displayName, kind = DEFAULT_TENANT_KIND, createdByUserId, ownerUserId = null }) {
  return [slug, displayName, kind, createdByUserId, ownerUserId]
}

export async function insertTenant(executor, attrs) {
  const { rows } = await executor.query(
    `INSERT INTO tenants (${TENANT_INSERT_COLUMNS})
     VALUES ($1, $2, $2, $3, $4, $5)
     RETURNING ${tenantSafeProjection()}`,
    insertValues(attrs),
  )
  return rows[0]
}

// Insert variant for server-generated slugs: a slug collision returns null
// instead of raising 23505 (which would abort the caller's transaction), so
// the service can try the next dedupe suffix within the same transaction.
export async function insertTenantIfSlugFree(executor, attrs) {
  const { rows } = await executor.query(
    `INSERT INTO tenants (${TENANT_INSERT_COLUMNS})
     VALUES ($1, $2, $2, $3, $4, $5)
     ON CONFLICT (slug) DO NOTHING
     RETURNING ${tenantSafeProjection()}`,
    insertValues(attrs),
  )
  return rows[0] ?? null
}

// The personal-workspace insert has no slug to retry against a unique index and
// no ON CONFLICT on (owner_user_id) WHERE kind = 'personal' to lean on for the
// returning row, so creation reads first; this fetch is the idempotency check.
export async function fetchPersonalTenant(executor, ownerUserId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection()} FROM tenants
      WHERE owner_user_id = $1 AND kind = 'personal'`,
    [ownerUserId],
  )
  return rows[0] || null
}

// Tenants a user owns (self-service management list), newest first.
export async function listOwnedTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT ${tenantSafeProjection('t')},
            p.country_code AS accounting_country,
            (SELECT COUNT(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.status = 'approved') AS member_count
       FROM tenants t
       LEFT JOIN tenant_accounting_profiles p ON p.tenant_id = t.id
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

// Self-service deletion access survives the archive phase, so unlike the
// ordinary active-tenant middleware this lookup intentionally includes
// archived/deletion-failed tenants. Absence of a membership returns null and
// lets the service conceal the tenant with a 404.
export async function fetchTenantDeletionAccess(executor, tenantId, userId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.slug, t.kind, t.display_name, t.band_name,
            t.owner_user_id, t.archived_at, t.deletion_status,
            m.role, m.status AS membership_status
       FROM tenants t
       JOIN memberships m ON m.tenant_id = t.id AND m.user_id = $2
      WHERE t.id = $1
      FOR UPDATE OF t`,
    [tenantId, userId],
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
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3, 'owner')`,
    [userId, tenantId, approvedByUserId],
  )
}

// Whichever of the two name columns a caller sets, the other gets the same
// value — see TENANT_INSERT_COLUMNS.
const NAME_MIRROR = Object.freeze({ band_name: 'display_name', display_name: 'band_name' })

function withNameMirror(fields) {
  return fields.flatMap((fragment) => {
    const [column, placeholder] = fragment.split(' = ')
    const counterpart = NAME_MIRROR[column]
    return counterpart ? [fragment, `${counterpart} = ${placeholder}`] : [fragment]
  })
}

// Applies prebuilt SET fragments to a tenant, appending updated_at and the WHERE
// binding. Returns the updated row or null.
export async function updateTenantFields(executor, tenantId, fields, values) {
  const assignments = [...withNameMirror(fields), 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE tenants SET ${assignments.join(', ')} WHERE id = $${whereIdx}
       AND deletion_status IS NULL
     RETURNING ${tenantSafeProjection()}`,
    [...values, tenantId],
  )
  return rows[0] || null
}

export async function lockTenantSlug(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, slug, slug_revision
       FROM tenants
      WHERE id = $1
        AND kind = 'band'
        AND archived_at IS NULL
        AND deletion_status IS NULL
      FOR UPDATE`,
    [tenantId],
  )
  return rows[0] || null
}

export async function advanceTenantSlug(executor, tenantId, slug) {
  const { rows } = await executor.query(
    `UPDATE tenants
        SET slug = $2,
            slug_revision = slug_revision + 1,
            updated_at = NOW()
      WHERE id = $1
        AND kind = 'band'
        AND archived_at IS NULL
        AND deletion_status IS NULL
     RETURNING slug, slug_revision`,
    [tenantId, slug],
  )
  return rows[0] || null
}

// Discoverability opt-in. Its own writer rather than a PATCHABLE field: the
// profile PATCH is planning.write, and letting strangers find the band is a
// tenant.manage decision.
export async function updateJoinPolicy(executor, tenantId, joinPolicy) {
  const { rows } = await executor.query(
    `UPDATE tenants SET join_policy = $2, updated_at = NOW()
      WHERE id = $1 AND kind = 'band' AND deletion_status IS NULL
     RETURNING ${tenantSafeProjection()}`,
    [tenantId, joinPolicy],
  )
  return rows[0] || null
}

// Every tenant the user is an APPROVED member of and that is not archived —
// the tenant set the cross-tenant artist agenda reads through. Derived server-side from
// memberships: the client never names the tenants it wants.
export async function listApprovedMemberTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.kind, t.slug, t.display_name, t.avatar_path, m.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.status = 'approved'
        AND t.archived_at IS NULL
        AND t.deletion_status IS NULL
        AND (t.kind = 'band' OR t.owner_user_id = $1)
      ORDER BY t.kind DESC, t.display_name ASC, t.id ASC`,
    [userId],
  )
  return rows
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
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3, 'admin')
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
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id, source)
     VALUES ($1, $2, $3, 'approved', NOW(), $4, 'admin')
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
      WHERE id = $1 AND deletion_status IS NULL RETURNING ${tenantSafeProjection()}`,
    [tenantId],
  )
  return rows[0] || null
}

export async function fetchTenantForDeletion(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT id, slug, archived_at, deletion_status FROM tenants WHERE id = $1 FOR UPDATE',
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
       UNION ALL SELECT image_path FROM dashboard_tiles
        WHERE tenant_id = $1 AND type = 'memory_tile'
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

export async function markTenantDeletionState(executor, tenantId, status, errorCode = null) {
  await executor.query(
    `UPDATE tenants
        SET deletion_status = $2,
            deletion_error_code = $3,
            deletion_requested_at = CASE WHEN $2 = 'pending' THEN NOW() ELSE deletion_requested_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [tenantId, status, errorCode],
  )
}
