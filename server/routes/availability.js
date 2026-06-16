import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/availabilityValidators.js'
import {
  listRange,
  listOnDate,
  createSlot,
  patchSlot,
  deleteSlot,
} from '../services/availabilityService.js'

const router = Router()

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  const result = await listRange(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.slots)
})

router.get('/on/:date', async (req, res) => {
  res.json(await listOnDate(pool, req.tenantId, req.params.date))
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createSlot(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.slot)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await patchSlot(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.slot)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteSlot(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
