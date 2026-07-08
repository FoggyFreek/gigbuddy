// Self-service tenant endpoints, mounted at /api/tenants behind requireApproved
// (no active-tenant resolution — creating and managing owned tenants is a
// cross-tenant, user-level concern).
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireCurrentTerms } from '../middleware/auth.js'
import {
  createOwnedTenant,
  listOwnedTenants,
  archiveOwnedTenant,
  unarchiveOwnedTenant,
} from '../services/tenantSelfService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

router.post('/', requireCurrentTerms, async (req, res) => {
  const result = await createOwnedTenant(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, result.audit.action, result.audit.details)
  res.status(201).json(result.tenant)
})

router.get('/owned', async (req, res) => {
  res.json(await listOwnedTenants(pool, req.user.id))
})

router.post('/:id/archive', requireCurrentTerms, async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await archiveOwnedTenant(pool, req.user.id, id)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  res.json(result.tenant)
})

router.post('/:id/unarchive', requireCurrentTerms, async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await unarchiveOwnedTenant(pool, req.user.id, id)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  res.json(result.tenant)
})

export default router
