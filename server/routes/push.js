import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

router.get('/vapid-public-key', (_req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID not configured' })
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys (p256dh, auth) are required' })
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [req.user.id, endpoint, keys.p256dh, keys.auth]
  )
  res.status(201).json({ ok: true })
})

router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' })
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
    [endpoint, req.user.id]
  )
  res.status(204).end()
})

// Called by the service worker's pushsubscriptionchange handler when the
// browser rotates the endpoint. CSRF-exempt (see csrf.js) because service
// workers can't access the in-memory CSRF token; sameSite:lax cookies + the
// oldEndpoint+user_id match are the integrity gate here.
router.post('/resubscribe', async (req, res) => {
  const { oldEndpoint, endpoint, keys } = req.body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys (p256dh, auth) are required' })
  }
  if (oldEndpoint) {
    const { rowCount } = await pool.query(
      `UPDATE push_subscriptions
         SET endpoint = $1, p256dh = $2, auth = $3
       WHERE endpoint = $4 AND user_id = $5`,
      [endpoint, keys.p256dh, keys.auth, oldEndpoint, req.user.id]
    )
    if (rowCount) return res.status(204).end()
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [req.user.id, endpoint, keys.p256dh, keys.auth]
  )
  res.status(204).end()
})

export default router
