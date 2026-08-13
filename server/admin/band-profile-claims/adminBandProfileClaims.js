// Mounted at /api/admin/band-profile-claims on the super-admin tier. The
// verification behind a decision happens offline; these routes record it.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import {
  listQueue,
  listUnclaimedProfiles,
  deleteUnclaimedProfile,
  approveClaim,
  rejectClaim,
} from './adminBandProfileClaimService.js'

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

// Sits under /unclaimed because that listing is the only place it is reachable
// from, and because only an unclaimed profile may be deleted at all.
router.delete('/unclaimed/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteUnclaimedProfile(pool, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.post('/:id/approve', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await approveClaim(pool, req.user, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json({ claim: result.claim, profile: result.profile })
})

router.post('/:id/reject', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await rejectClaim(pool, req.user, id, req.body)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json({ claim: result.claim })
})

export default router
