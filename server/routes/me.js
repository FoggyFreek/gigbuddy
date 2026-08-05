// The cross-tenant hub, mounted at /api/me on its own access tier:
// authenticated + terms accepted + resolveMemberTenantIds, and deliberately
// NO resolveTenantId — these reads span tenants rather than sitting inside one.
//
// Every rule about which tenants a caller may see lives in meService; handlers
// here just pass `req.memberTenants` (server-derived) and `req.query` through.
import { Router } from 'express'
import pool from '../db/index.js'
import { sendError } from './routeHelpers.js'
import {
  listMyBands,
  listMyAgenda,
  listMyPastAgenda,
  listMyEarnings,
} from '../services/meService.js'

const router = Router()

// The bands I'm in (phase 4 unions external ensembles into this list).
router.get('/bands', async (req, res) => {
  res.json(await listMyBands(pool, req.memberTenants))
})

// Everything I'm booked for in a day window, across every band.
router.get('/agenda', async (req, res) => {
  const result = await listMyAgenda(pool, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Deep history, keyset-paginated (?limit=&cursorDate=&cursorId=).
router.get('/agenda/past', async (req, res) => {
  const result = await listMyPastAgenda(pool, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Per band, never a single total — see the invariant in meService.
router.get('/earnings', async (req, res) => {
  const result = await listMyEarnings(pool, req.user, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
