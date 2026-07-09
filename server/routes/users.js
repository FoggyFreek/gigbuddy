import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listMemberships,
  patchMembership,
  patchBandMember,
  removeMembership,
} from '../services/userService.js'

const router = Router()

function logAudit(req, audit) {
  if (audit) auditLog(req, audit.action, audit.details)
}

router.get('/', async (req, res) => {
  res.json(await listMemberships(pool, req.tenantId))
})

router.patch('/:userId/membership', async (req, res) => {
  const userId = requireParam(req, res, 'userId'); if (userId === null) return
  const result = await patchMembership(pool, req.tenantId, req.user, userId, req.body)
  logAudit(req, result.audit)
  if (result.error) return sendError(res, result.error)
  res.json(result.membership)
})

router.patch('/:userId/band-member', async (req, res) => {
  const userId = requireParam(req, res, 'userId'); if (userId === null) return
  const result = await patchBandMember(pool, req.tenantId, userId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.membership)
})

router.delete('/:userId', async (req, res) => {
  const userId = requireParam(req, res, 'userId'); if (userId === null) return
  const result = await removeMembership(pool, req.tenantId, req.user, userId)
  logAudit(req, result.audit)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
