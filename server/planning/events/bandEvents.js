import { Router } from 'express'
import pool from '../../db/index.js'
import { requirePermission } from '../../middleware/permissions.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { requireParam, sendError, viewerOf } from '../../platform/http/routeHelpers.js'
import {
  listEvents,
  listUpcomingEvents,
  listPastEvents,
  listEventsInRange,
  getEvent,
  createEvent,
  patchEvent,
  deleteEvent,
  addParticipant,
  removeParticipant,
} from './bandEventService.js'
import { parseId } from './bandEventValidators.js'

const router = Router()

// The tenant kind decides whether member availability applies at all, and the
// viewer how much of each linked member's is revealed. Neither comes from the
// client.
function availabilityScope(req) {
  return { tenantKind: req.tenantKind, viewer: viewerOf(req) }
}

router.get('/', async (req, res) => {
  res.json(await listEvents(pool, req.tenantId, availabilityScope(req)))
})

router.get('/upcoming', async (req, res) => {
  const result = await listUpcomingEvents(pool, req.tenantId, req.query, availabilityScope(req))
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/past', async (req, res) => {
  const result = await listPastEvents(pool, req.tenantId, req.query, availabilityScope(req))
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Calendar month read: events overlapping the inclusive ?from=&to= day window.
router.get('/range', async (req, res) => {
  const result = await listEventsInRange(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getEvent(pool, req.tenantId, id, availabilityScope(req))
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

router.post('/:id/participants', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const eventId = requireParam(req, res, 'id'); if (eventId === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })

  const result = await addParticipant(pool, req.tenantId, eventId, memberId, availabilityScope(req))
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.event)
})

router.delete('/:id/participants/:bandMemberId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const eventId = requireParam(req, res, 'id'); if (eventId === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return

  const result = await removeParticipant(pool, req.tenantId, eventId, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
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
