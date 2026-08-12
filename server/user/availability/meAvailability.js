// The musician's own availability calendar, on the /api/me tier: authenticated
// + terms accepted, no active tenant required. Availability belongs to the
// user, so this router never resolves or consults a tenant.
//
// The band-side grid keeps its own URLs (server/planning/availability/availability.js) and
// reads a redacted projection of the same rows.
import { Router } from 'express'
import pool from '../../db/index.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import {
  listMyAvailability,
  createMyAvailability,
  patchMyAvailability,
  deleteMyAvailability,
  getAvailabilitySettings,
  patchAvailabilitySettings,
} from './userAvailabilityService.js'

const router = Router()

// Registered before `/:id` so the literal path is never captured as an id.
router.get('/settings', async (req, res) => {
  res.json(await getAvailabilitySettings(pool, req.user.id))
})

// The privacy flags and the per-band delegation list. Editable only here — no
// band-side screen can reach them.
router.patch('/settings', async (req, res) => {
  const result = await patchAvailabilitySettings(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.settings)
})

router.get('/', async (req, res) => {
  const result = await listMyAvailability(pool, req.user.id, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/', async (req, res) => {
  const result = await createMyAvailability(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.slot)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchMyAvailability(pool, req.user.id, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.slot)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteMyAvailability(pool, req.user.id, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
