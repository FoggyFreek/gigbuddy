import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/bandEventValidators.js'
import {
  listEvents,
  getEvent,
  createEvent,
  patchEvent,
  deleteEvent,
} from '../services/bandEventService.js'

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
  res.json(await listEvents(pool, req.tenantId))
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await getEvent(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

router.post('/', async (req, res) => {
  const result = await createEvent(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.event)
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await patchEvent(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteEvent(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
