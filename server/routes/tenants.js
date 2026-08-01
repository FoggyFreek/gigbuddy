import { Router } from 'express'
import pool from '../db/index.js'
import {
  listTenants,
  getTenant,
  createTenant,
  patchTenant,
  addAdmin,
  addMembership,
  removeAdmin,
  setArchived,
  deleteTenant,
} from '../services/tenantService.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listTenants(pool))
})

router.get('/:id', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await getTenant(pool, tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.post('/', async (req, res) => {
  const result = await createTenant(req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.tenant)
})

router.patch('/:id', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await patchTenant(pool, tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  res.json(result.tenant)
})

router.post('/:id/admins', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await addAdmin(pool, tenantId, req.body, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.membership)
})

// Super-admin direct grant: upsert an approved membership in any tenant.
router.post('/:id/memberships', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await addMembership(pool, tenantId, req.body, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.membership)
})

router.delete('/:id/admins/:userId', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const userId = requireParam(req, res, 'userId'); if (userId === null) return
  const result = await removeAdmin(pool, tenantId, userId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.post('/:id/archive', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await setArchived(pool, tenantId, true)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.post('/:id/unarchive', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await setArchived(pool, tenantId, false)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.delete('/:id', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const result = await deleteTenant(pool, tenantId, req.body?.confirmationSlug)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  res.status(204).end()
})

export default router
