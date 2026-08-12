// The band directory, mounted at /api/band-directory on the user-level tier:
// authenticated + terms accepted, no active tenant and no membership set
// required (an artist searches from inside their own workspace).
//
// Every discoverability rule lives in bandDirectoryService — see the invariants
// documented there before changing anything here.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import {
  searchBands,
  listMyJoinRequests,
  requestToJoinBand,
  withdrawJoinRequest,
  notifyJoinRequested,
} from './bandDirectoryService.js'

const router = Router()

router.get('/search', async (req, res) => {
  const result = await searchBands(pool, req.user.id, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// The caller's own outstanding requests — what the withdraw affordance lists.
router.get('/join-requests', async (req, res) => {
  res.json(await listMyJoinRequests(pool, req.user.id))
})

router.post('/join-requests', async (req, res) => {
  const result = await requestToJoinBand(pool, req.user, req.body)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.notify) await notifyJoinRequested(result.notify)
  res.status(result.created ? 201 : 200).json(result.result)
})

// Withdrawing frees a slot against the outstanding-request cap.
router.delete('/join-requests/:tenantId', async (req, res) => {
  const result = await withdrawJoinRequest(pool, req.user.id, req.params.tenantId)
  if (result.error) return sendError(res, result.error)
  auditLog(req, result.audit.action, result.audit.details)
  res.status(204).end()
})

export default router
