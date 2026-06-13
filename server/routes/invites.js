import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { parseId } from '../validators/inviteValidators.js'
import {
  listInvites,
  createInvite,
  revokeInvite,
  redeemInvite,
} from '../services/inviteService.js'

export const adminRouter = Router()
export const redeemRouter = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// Emit any audit event the service produced, then translate the result.
function logAudit(req, audit) {
  if (audit) auditLog(req, audit.action, audit.details)
}

adminRouter.get('/', async (req, res) => {
  res.json(await listInvites(pool, req.tenantId))
})

adminRouter.post('/', async (req, res) => {
  const result = await createInvite(pool, req.tenantId, req.user, req.body)
  logAudit(req, result.audit)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.invite)
})

adminRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await revokeInvite(pool, req.tenantId, id)
  logAudit(req, result.audit)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

redeemRouter.post('/', async (req, res) => {
  const result = await redeemInvite(req.user, req.body)
  logAudit(req, result.audit)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.result)
})

export default { adminRouter, redeemRouter }
