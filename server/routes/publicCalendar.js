import { Router } from 'express'
import pool from '../db/index.js'
import { buildFeed } from '../services/calendarFeedService.js'
import { sendError } from './routeHelpers.js'

const router = Router()

// Unauthenticated. External calendar apps (Google/Apple/Outlook) poll this with
// no session cookie and no CSRF — the secret token in the path is the credential
// (this router is mounted before the csrf/auth middleware). The token is a bearer
// secret and revoke/rotate must invalidate immediately, so the response is
// explicitly uncacheable by shared/proxy/browser caches.
router.get('/:token/feed.ics', async (req, res) => {
  const result = await buildFeed(pool, req.params.token)
  if (result.error) return sendError(res, result.error)

  res.type('text/calendar; charset=utf-8')
  res.set('Content-Disposition', 'inline; filename="gigbuddy.ics"')
  res.set('Cache-Control', 'private, no-store')
  res.send(result.ics)
})

export default router
