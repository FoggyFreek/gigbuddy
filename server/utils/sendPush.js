import webpush from 'web-push'
import pool from '../db/index.js'

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
  console.warn('[push] VAPID_* env vars not set — push notifications disabled')
}

export async function sendPushToAll(payload) {
  if (!configured) return
  const { rows } = await pool.query('SELECT * FROM push_subscriptions')
  if (!rows.length) return

  const notification = JSON.stringify(payload)
  const stale = []

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        notification,
      )
    )
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const status = result.reason?.statusCode
      if (status === 410 || status === 404) {
        stale.push(rows[i].endpoint)
      } else {
        console.error('[push] send failed', {
          endpoint: rows[i].endpoint,
          status,
          message: result.reason?.message,
        })
      }
    }
  }

  if (stale.length) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [stale])
  }
}
