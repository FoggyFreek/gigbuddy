import webpush from 'web-push'
import pool from '../db/index.js'
import { logger } from './logger.js'

// Web Push endpoint URLs embed a per-device subscriber token in the path
// (e.g. https://fcm.googleapis.com/fcm/send/<token>), not just a service
// name — never log the full endpoint. The host alone identifies which push
// service rejected the message without exposing the subscription.
function safeHost(endpoint) {
  try {
    return new URL(endpoint).host
  } catch {
    return null
  }
}

const configured = Boolean(
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY &&
  process.env.VAPID_SUBJECT,
)

if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
} else {
  logger.warn('push.vapid_not_configured', {})
}

async function fanOut(rows, payload) {
  const notification = JSON.stringify(payload)
  const stale = []

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        notification,
      ),
    ),
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const status = result.reason?.statusCode
      if (status === 410 || status === 404) {
        stale.push(rows[i].endpoint)
      } else {
        logger.error('push.send_failed', { err: result.reason, endpointHost: safeHost(rows[i].endpoint) })
      }
    }
  }

  if (stale.length) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [stale])
  }
}

async function tenantSlug(tenantId) {
  const { rows } = await pool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])
  return rows[0]?.slug ?? null
}

export async function sendPushToTenant(tenantId, payload) {
  if (!configured) return
  const { rows } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN memberships m ON m.user_id = ps.user_id
     WHERE m.tenant_id = $1 AND m.status = 'approved'`,
    [tenantId],
  )
  if (!rows.length) return
  const slug = await tenantSlug(tenantId)
  await fanOut(rows, { ...payload, tenantId, tenantSlug: slug })
}

export async function sendPushToMember(bandMemberId, tenantId, payload) {
  if (!configured) return
  const { rows: members } = await pool.query(
    `SELECT user_id FROM band_members
     WHERE id = $1 AND tenant_id = $2 AND user_id IS NOT NULL`,
    [bandMemberId, tenantId],
  )
  if (!members.length) return
  const { rows } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN memberships m ON m.user_id = ps.user_id AND m.tenant_id = $2
     WHERE ps.user_id = $1 AND m.status = 'approved'`,
    [members[0].user_id, tenantId],
  )
  if (!rows.length) return
  const slug = await tenantSlug(tenantId)
  await fanOut(rows, { ...payload, tenantId, tenantSlug: slug })
}
