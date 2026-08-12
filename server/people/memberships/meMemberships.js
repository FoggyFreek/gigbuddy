// Mounted at /api/me/memberships on the user-level tier: authenticated + terms
// accepted, and deliberately NO resolveTenantId. Leaving a band is a fact about
// the user, so an artist does it from their own workspace with no band selected
// — the same reasoning that puts /invites/redeem and /api/me/availability on
// this tier rather than inside an active tenant.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { leaveTenant } from './userService.js'

const router = Router()

router.delete('/:tenantId', async (req, res) => {
  const tenantId = requireParam(req, res, 'tenantId'); if (tenantId === null) return
  const result = await leaveTenant(pool, req.user, tenantId)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
