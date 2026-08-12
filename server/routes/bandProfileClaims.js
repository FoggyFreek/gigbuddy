// Mounted at /api/band-profile-claims on the tenant tier with tenant.manage and
// the BAND_PROFILE_CLAIM capability: claiming is a band-workspace action taken
// by someone who administers it.
//
// A tenant sees only its OWN claim here. The queue, and who else wants the same
// profile, are the super admin's business alone (/api/admin/band-profile-claims).
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  getOwnClaim,
  requestClaim,
  withdrawClaim,
} from '../services/bandProfileClaimService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await getOwnClaim(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// 201 for a fresh claim, 200 when the same claim is re-submitted.
router.post('/', async (req, res) => {
  const result = await requestClaim(pool, req.user, req.tenantId, req.body)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(result.created ? 201 : 200).json(result.claim)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await withdrawClaim(pool, req.tenantId, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
