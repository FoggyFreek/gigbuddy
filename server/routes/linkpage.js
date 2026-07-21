import { Router } from 'express'
import pool from '../db/index.js'
import { createHandoff, getStatus } from '../services/linkpageService.js'
import { sendError } from './routeHelpers.js'

const router = Router()

// Whether the integration is configured, plus the band's public page URL —
// drives the "Edit link page" affordance in the profile UI.
router.get('/status', async (req, res) => {
  const result = await getStatus(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Mint a short-lived editor handoff for the active tenant. The browser opens
// the returned URL; the linkpage app exchanges the token for its own session.
router.post('/handoff', async (req, res) => {
  const result = await createHandoff(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
