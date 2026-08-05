// The cross-tenant artist agenda, mounted at /api/me on its own access tier:
// authenticated + terms accepted + resolveMemberTenantIds, and deliberately
// NO resolveTenantId — these reads span tenants rather than sitting inside one.
//
// Every rule about which tenants a caller may see lives in meService; handlers
// here just pass `req.memberTenants` (server-derived) and `req.query` through.
import { Router } from 'express'
import pool from '../db/index.js'
import { sendError } from './routeHelpers.js'
import { listMyAgenda } from '../services/meService.js'

const router = Router()

// Everything I'm booked for in a day window, across every band.
router.get('/agenda', async (req, res) => {
  const result = await listMyAgenda(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
