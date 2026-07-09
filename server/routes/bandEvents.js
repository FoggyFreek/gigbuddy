import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listEvents,
  getEvent,
  createEvent,
  patchEvent,
  deleteEvent,
} from '../services/bandEventService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listEvents(pool, req.tenantId))
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getEvent(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createEvent(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.event)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchEvent(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteEvent(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
