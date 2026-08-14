import { Router } from 'express'
import pool from '../../db/index.js'
import { createHandoff, getStats, getStatus, listPages } from './linkpageService.js'
import { sendError } from '../../platform/http/routeHelpers.js'

const router = Router()

// Whether the integration is configured, plus the band's public page URL —
// drives the "Edit link page" affordance in the profile UI.
router.get('/status', async (req, res) => {
  const result = await getStatus(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Aggregate visit statistics for the active tenant's link page, proxied from
// the decoupled app — the dashboard tile's only source.
router.get('/stats', async (req, res) => {
  const result = await getStats(req.tenantId, req.query.days ?? 30, req.query.pageId)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// The active tenant's link pages — drives the dashboard tile's page picker.
router.get('/pages', async (req, res) => {
  const result = await listPages(req.tenantId)
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
