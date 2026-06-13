import { Router } from 'express'
import pool from '../db/index.js'
import { subscribe, unsubscribe, resubscribe } from '../services/pushService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/vapid-public-key', (_req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID not configured' })
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

router.post('/subscribe', async (req, res) => {
  const result = await subscribe(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json({ ok: true })
})

router.delete('/unsubscribe', async (req, res) => {
  const result = await unsubscribe(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Called by the service worker's pushsubscriptionchange handler when the
// browser rotates the endpoint. CSRF-exempt (see csrf.js) because service
// workers can't access the in-memory CSRF token; sameSite:lax cookies + the
// oldEndpoint+user_id match are the integrity gate here.
router.post('/resubscribe', async (req, res) => {
  const result = await resubscribe(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
