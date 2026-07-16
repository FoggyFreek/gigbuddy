import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listTasks,
  createTask,
  patchTask,
  removeTask,
} from '../services/taskService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await listTasks(pool, req.tenantId, req.user.id, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createTask(pool, req.tenantId, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.task)
})

// Update task. Readers may toggle `done` on their own assigned task; the
// self-scope is enforced in the service via the caller context below.
router.patch('/:id', requirePermission(PERMISSIONS.TASK_COMPLETE_SELF), async (req, res) => {
  const taskId = requireParam(req, res, 'id'); if (taskId === null) return
  const caller = { role: req.membership?.role, isSuperAdmin: !!req.user?.is_super_admin, userId: req.user.id }
  const result = await patchTask(pool, req.tenantId, taskId, req.body || {}, caller)
  if (result.error) return sendError(res, result.error)
  res.json(result.task)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const taskId = requireParam(req, res, 'id'); if (taskId === null) return
  const result = await removeTask(pool, req.tenantId, taskId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
