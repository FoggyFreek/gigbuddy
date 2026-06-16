import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/bandMemberValidators.js'
import {
  listMembers,
  createMember,
  patchMember,
  deleteMember,
} from '../services/bandMemberService.js'

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
  res.json(await listMembers(pool, req.tenantId))
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createMember(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.member)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await patchMember(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.member)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteMember(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
