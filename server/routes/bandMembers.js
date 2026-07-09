import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listMembers,
  createMember,
  patchMember,
  deleteMember,
} from '../services/bandMemberService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listMembers(pool, req.tenantId))
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createMember(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.member)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchMember(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.member)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteMember(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
