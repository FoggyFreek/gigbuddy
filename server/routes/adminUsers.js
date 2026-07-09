import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { listUsers, deleteUser } from '../services/adminUserService.js'
import { requireParam, sendError } from './routeHelpers.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listUsers(pool))
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteUser(pool, req.user.id, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
