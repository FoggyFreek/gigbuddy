// In-app notification domain logic. Functions that can fail with a specific
// HTTP outcome return { error: { status, body } }; success returns a payload.
//
// dispatchNotification is the single write path used by the notify* seams
// (gig/rehearsal/invoice/task services). It uses the module-level pool on
// purpose: the seams run post-commit and must never join — or be rolled back
// with — a caller's transaction. Persistence is awaited (the durable part);
// web-push delivery stays fire-and-forget.
import pool from '../db/index.js'
import { sendPushToUsers, sendPushToUser } from '../utils/sendPush.js'
import { logger } from '../utils/logger.js'
import { ALL_ROLES, hasPermission } from '../auth/permissions.js'
import { NOTIFICATION_TYPES } from '../domain/notificationTypes.js'
import { notFound } from './serviceErrors.js'
import { parsePrefsBody } from '../validators/notificationValidators.js'
import { isApprovedMember } from '../repositories/authRepository.js'
import {
  listForUser,
  countUnread,
  markRead,
  markAllRead,
  deleteForUser,
  insertForUsers,
  insertForUserDeduped,
  pruneOldForUsers,
  pruneOldGlobal,
  resolveAudience,
  getUserIdForBandMember,
  getDisabledTypes,
  getDisabledTenants,
  listApprovedTenants,
  upsertTypePref,
  upsertTenantPref,
  getTenantAvatarPath,
} from '../repositories/notificationRepository.js'

const NOT_FOUND = notFound('Not found')
const LIST_LIMIT = 50
const GLOBAL_PRUNE_INTERVAL_MS = 60 * 60 * 1000

// Dispatch-time and list-time pruning only reach users who are active; this
// throttled global sweep bounds rows of dormant users too (no cron infra).
let lastGlobalPruneAt = 0
async function maybePruneGlobal() {
  const now = Date.now()
  if (now - lastGlobalPruneAt < GLOBAL_PRUNE_INTERVAL_MS) return
  lastGlobalPruneAt = now
  await pruneOldGlobal(pool)
}

function toApi(row) {
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantAvatarPath: row.tenant_avatar_path,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    sourceType: row.source_type,
    sourceId: row.source_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

// ---------- dispatch (the seams' entry point) ----------

export async function dispatchNotification({
  tenantId,
  type,
  title,
  body = '',
  url,
  sourceType = null,
  sourceId = null,
  bandMemberId = null,
  requiredPermission = null,
}) {
  let userId = null
  if (bandMemberId != null) {
    userId = await getUserIdForBandMember(pool, bandMemberId, tenantId)
    if (userId === null) return
  }

  const allowedRoles = requiredPermission
    ? ALL_ROLES.filter((role) => hasPermission(role, requiredPermission))
    : null

  const userIds = await resolveAudience(pool, tenantId, type, { userId, allowedRoles })
  if (!userIds.length) return

  await insertForUsers(pool, userIds, { tenantId, type, title, body, url, sourceType, sourceId })
  await pruneOldForUsers(pool, userIds)
  await maybePruneGlobal()

  // Prefs already narrowed the audience; the push "master toggle" is simply
  // whether the user's browser holds a subscription. Delivery is best-effort.
  sendPushToUsers(userIds, tenantId, { title, body, tag: type, url })
    .catch((err) => logger.error('push.send_to_users_failed', { err, tenantId }))
}

// User-level (billing) notification dispatch. Unlike dispatchNotification, this
// targets one user directly (the subscription owner) with no tenant fan-out and
// no audience prefs — a payment-failed or plan-changed notice is transactional
// and must reach the owner. The in-app row is inserted on the CALLER'S tx
// client (`client`) so it commits atomically with the billing state change;
// dedupeKey makes replays (webhook + reconcile) land exactly one row. Web push
// is fired only after commit, by the caller, using the returned `inserted`
// flag — never inside the transaction. Returns { inserted }.
export async function dispatchUserNotification({
  userId, type, title, body = '', url, dedupeKey = null, client,
}) {
  const executor = client ?? pool
  const inserted = await insertForUserDeduped(executor, {
    userId, tenantId: null, type, title, body, url, dedupeKey,
  })
  return { inserted }
}

// Post-commit best-effort web push for a user-level notification. Call this
// AFTER the transaction commits, and only when dispatchUserNotification
// reported a fresh insert, so a rolled-back transition sends no push.
export function pushUserNotification(userId, { type, title, body = '', url }) {
  sendPushToUser(userId, { title, body, tag: type, url })
    .catch((err) => logger.error('push.send_to_user_failed', { err }))
}

// ---------- reads ----------

export async function listNotifications(db, userId) {
  await pruneOldForUsers(db, [userId])
  const [rows, unreadCount] = await Promise.all([
    listForUser(db, userId, LIST_LIMIT),
    countUnread(db, userId),
  ])
  return { notifications: rows.map(toApi), unreadCount }
}

// ---------- writes ----------

export async function markNotificationRead(db, userId, id) {
  const updated = await markRead(db, userId, id)
  return updated ? {} : NOT_FOUND
}

export async function markAllNotificationsRead(db, userId) {
  await markAllRead(db, userId)
  return {}
}

export async function removeNotification(db, userId, id) {
  const deleted = await deleteForUser(db, userId, id)
  return deleted ? {} : NOT_FOUND
}

// ---------- preferences ----------

export async function getPreferences(db, userId) {
  const [disabledTypes, disabledTenants, tenants] = await Promise.all([
    getDisabledTypes(db, userId),
    getDisabledTenants(db, userId),
    listApprovedTenants(db, userId),
  ])
  return {
    types: NOTIFICATION_TYPES.map((type) => ({ type, enabled: !disabledTypes.has(type) })),
    tenants: tenants.map((t) => ({
      tenantId: t.id,
      tenantName: t.band_name,
      avatarPath: t.avatar_path,
      enabled: !disabledTenants.has(t.id),
    })),
  }
}

export async function updatePreferences(db, userId, body) {
  const parsed = parsePrefsBody(body)
  if (parsed.error) {
    return { error: { status: 400, body: { error: parsed.error } } }
  }

  // A tenant pref may only target the caller's own approved memberships; a
  // foreign tenant id 404s so existence isn't leaked.
  for (const { tenantId } of parsed.tenants) {
    if (!(await isApprovedMember(db, userId, tenantId))) return NOT_FOUND
  }

  for (const { type, enabled } of parsed.types) {
    await upsertTypePref(db, userId, type, enabled)
  }
  for (const { tenantId, enabled } of parsed.tenants) {
    await upsertTenantPref(db, userId, tenantId, enabled)
  }

  return { prefs: await getPreferences(db, userId) }
}

// ---------- tenant profile picture ----------

export async function getTenantAvatar(db, userId, tenantId) {
  const avatarPath = await getTenantAvatarPath(db, userId, tenantId)
  if (!avatarPath) return NOT_FOUND
  return { avatarPath }
}
