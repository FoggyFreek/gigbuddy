import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { listUsers, deleteUser } from '../services/adminUserService.js'
import { parseId } from '../validators/adminUserValidators.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  res.json(await listUsers(pool))
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await deleteUser(pool, req.user.id, id)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
