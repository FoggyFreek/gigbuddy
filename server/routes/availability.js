import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS, hasPermission } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listRange,
  listOnDate,
  createSlot,
  patchSlot,
  deleteSlot,
} from '../services/availabilityService.js'

const router = Router()

// Who is writing, and what they may do here. A member may always edit their
// OWN availability (availability.write.self, granted to readers too); editing
// someone else's additionally needs planning.write AND that member's
// delegation — see assertMayWriteFor.
function actorOf(req) {
  return {
    userId: req.user.id,
    canPlanningWrite: hasPermission(req.membership?.role, PERMISSIONS.PLANNING_WRITE, {
      isSuperAdmin: !!req.user.is_super_admin,
    }),
  }
}

// The viewer decides how much of each linked member's entry is revealed.
function viewerOf(req) {
  return { userId: req.user.id, tenantId: req.tenantId }
}

router.get('/', async (req, res) => {
  const result = await listRange(pool, req.tenantId, req.query, viewerOf(req))
  if (result.error) return sendError(res, result.error)
  res.json(result.slots)
})

router.get('/on/:date', async (req, res) => {
  res.json(await listOnDate(pool, req.tenantId, req.params.date, viewerOf(req)))
})

// Gated on the SELF permission so a reader can record their own availability;
// writing another member's is refused inside the service unless they delegated.
router.post('/', requirePermission(PERMISSIONS.AVAILABILITY_WRITE_SELF), async (req, res) => {
  const result = await createSlot(pool, req.tenantId, req.body, actorOf(req))
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.slot)
})

router.patch('/:id', requirePermission(PERMISSIONS.AVAILABILITY_WRITE_SELF), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchSlot(pool, req.tenantId, id, req.body, actorOf(req))
  if (result.error) return sendError(res, result.error)
  res.json(result.slot)
})

router.delete('/:id', requirePermission(PERMISSIONS.AVAILABILITY_WRITE_SELF), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteSlot(pool, req.tenantId, id, actorOf(req))
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
