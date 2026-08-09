// Mounted at /api/admin/band-profile-claims on the super-admin tier. The
// verification behind a decision happens offline; these routes record it.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listQueue,
  listUnclaimedProfiles,
  approveClaim,
  rejectClaim,
} from '../services/adminBandProfileClaimService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await listQueue(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/unclaimed', async (req, res) => {
  const result = await listUnclaimedProfiles(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/:id/approve', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await approveClaim(pool, req.user, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json({ claim: result.claim, profile: result.profile, profileDeleted: result.profileDeleted })
})

router.post('/:id/reject', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await rejectClaim(pool, req.user, id, req.body)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json({ claim: result.claim })
})

export default router
