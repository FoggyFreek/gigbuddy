import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { listUsers, deleteUser } from '../services/adminUserService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  res.json(await listUsers(pool))
})

router.delete('/:id', async (req, res) => {
  const result = await deleteUser(pool, req.user.id, Number(req.params.id))
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
