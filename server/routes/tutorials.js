// Generic tutorial endpoints. User-scoped (a dismissal is per-user, global,
// cross-tenant) — mounted with requireApproved only, no active-tenant
// resolution. The dismissed keys themselves ride on the /auth/me payload.
import { Router } from 'express'
import pool from '../db/index.js'
import { parseTutorialKey } from '../validators/tutorialValidators.js'
import { dismissTutorial } from '../services/tutorialService.js'

const router = Router()

// ---------- POST /api/tutorials/:key/dismiss ----------
router.post('/:key/dismiss', async (req, res, next) => {
  const key = parseTutorialKey(req.params.key)
  if (!key) return res.status(400).json({ error: 'invalid_tutorial_key' })
  try {
    await dismissTutorial(pool, req.user.id, key)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
