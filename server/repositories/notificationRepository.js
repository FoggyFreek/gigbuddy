// SQL for in-app notifications and notification preferences. No business
// decisions here; every function takes an executor (pool or tx client) first.
//
// Scoping note: notifications are deliberately user-scoped and cross-tenant
// (see migration 097) — reads/writes are guarded by user_id, not tenant_id.
// Rows only ever come from approved-membership fan-out (resolveAudience).

const RETENTION = "INTERVAL '90 days'"

export async function listForUser(executor, userId, limit) {
  const { rows } = await executor.query(
    `SELECT n.id, n.tenant_id, n.type, n.title, n.body, n.url,
            n.source_type, n.source_id, n.read_at, n.created_at,
            t.band_name AS tenant_name, t.avatar_path AS tenant_avatar_path
     FROM notifications n
     JOIN tenants t ON t.id = n.tenant_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows
}

export async function countUnread(executor, userId) {
  const { rows } = await executor.query(
    'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  )
  return rows[0].n
}

// COALESCE keeps re-reading an already-read row idempotent (still owned → 204).
export async function markRead(executor, userId, id) {
  const { rowCount } = await executor.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return rowCount > 0
}

export async function markAllRead(executor, userId) {
  await executor.query(
    'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  )
}

export async function deleteForUser(executor, userId, id) {
  const { rowCount } = await executor.query(
    'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return rowCount > 0
}

export async function insertForUsers(executor, userIds, notification) {
  const { tenantId, type, title, body, url, sourceType, sourceId } = notification
  await executor.query(
    `INSERT INTO notifications (user_id, tenant_id, type, title, body, url, source_type, source_id)
     SELECT uid, $2, $3, $4, $5, $6, $7, $8 FROM unnest($1::int[]) AS uid`,
    [userIds, tenantId, type, title, body, url, sourceType, sourceId],
  )
}

export async function pruneOldForUsers(executor, userIds) {
  await executor.query(
    `DELETE FROM notifications
     WHERE user_id = ANY($1) AND created_at < NOW() - ${RETENTION}`,
    [userIds],
  )
}

export async function pruneOldGlobal(executor) {
  await executor.query(
    `DELETE FROM notifications WHERE created_at < NOW() - ${RETENTION}`,
  )
}

// The one query that encodes who receives a notification: approved members of
// the tenant, optionally narrowed to one user (bandMemberId targeting) and/or
// to roles holding a required permission (super admins always qualify), minus
// anyone who disabled this type or this tenant. Absence of a pref row = enabled.
export async function resolveAudience(executor, tenantId, type, { userId = null, allowedRoles = null } = {}) {
  const { rows } = await executor.query(
    `SELECT m.user_id
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = $1 AND m.status = 'approved'
       AND ($3::int IS NULL OR m.user_id = $3)
       AND ($4::text[] IS NULL OR m.role = ANY($4) OR u.is_super_admin)
       AND NOT EXISTS (
         SELECT 1 FROM notification_type_prefs p
         WHERE p.user_id = m.user_id AND p.type = $2 AND p.enabled = false)
       AND NOT EXISTS (
         SELECT 1 FROM notification_tenant_prefs tp
         WHERE tp.user_id = m.user_id AND tp.tenant_id = $1 AND tp.enabled = false)`,
    [tenantId, type, userId, allowedRoles],
  )
  return rows.map((r) => r.user_id)
}

export async function getUserIdForBandMember(executor, bandMemberId, tenantId) {
  const { rows } = await executor.query(
    'SELECT user_id FROM band_members WHERE id = $1 AND tenant_id = $2 AND user_id IS NOT NULL',
    [bandMemberId, tenantId],
  )
  return rows[0]?.user_id ?? null
}

export async function getDisabledTypes(executor, userId) {
  const { rows } = await executor.query(
    'SELECT type FROM notification_type_prefs WHERE user_id = $1 AND enabled = false',
    [userId],
  )
  return new Set(rows.map((r) => r.type))
}

export async function getDisabledTenants(executor, userId) {
  const { rows } = await executor.query(
    'SELECT tenant_id FROM notification_tenant_prefs WHERE user_id = $1 AND enabled = false',
    [userId],
  )
  return new Set(rows.map((r) => r.tenant_id))
}

export async function listApprovedTenants(executor, userId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.band_name, t.avatar_path
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND m.status = 'approved'
     ORDER BY t.band_name, t.id`,
    [userId],
  )
  return rows
}

export async function upsertTypePref(executor, userId, type, enabled) {
  await executor.query(
    `INSERT INTO notification_type_prefs (user_id, type, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, type) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [userId, type, enabled],
  )
}

export async function upsertTenantPref(executor, userId, tenantId, enabled) {
  await executor.query(
    `INSERT INTO notification_tenant_prefs (user_id, tenant_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [userId, tenantId, enabled],
  )
}

// Profile-picture lookup gated by the caller's approved membership in that tenant — the
// generic /api/files route only authorizes against the *active* tenant, which
// would 404 cross-tenant avatars in the bell. Returns null when the caller is
// not an approved member (indistinguishable from "no profile picture": both 404).
export async function getTenantAvatarPath(executor, userId, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.avatar_path
     FROM tenants t
     JOIN memberships m ON m.tenant_id = t.id AND m.user_id = $1 AND m.status = 'approved'
     WHERE t.id = $2`,
    [userId, tenantId],
  )
  if (!rows[0]) return null
  return rows[0].avatar_path ?? null
}
