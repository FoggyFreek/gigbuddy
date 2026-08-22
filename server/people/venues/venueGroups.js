import { Router } from 'express'
import pool from '../../db/index.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { requirePermission } from '../../middleware/permissions.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import {
  addVenueGroupMembers,
  createVenueGroup,
  deleteVenueGroup,
  listVenueGroups,
  removeVenueGroupMembers,
  renameVenueGroup,
} from './venueGroupService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await listVenueGroups(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createVenueGroup(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await renameVenueGroup(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.group)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteVenueGroup(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.post('/:id/members', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await addVenueGroupMembers(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.delete('/:id/members', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await removeVenueGroupMembers(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
