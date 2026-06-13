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
} from '../services/tenantService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  res.json(await listTenants(pool))
})

router.get('/:id', async (req, res) => {
  const result = await getTenant(pool, Number(req.params.id))
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.post('/', async (req, res) => {
  const result = await createTenant(req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.tenant)
})

router.patch('/:id', async (req, res) => {
  const result = await patchTenant(pool, Number(req.params.id), req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.post('/:id/admins', async (req, res) => {
  const result = await addAdmin(pool, Number(req.params.id), req.body, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.membership)
})

// Super-admin direct grant: upsert an approved membership in any tenant.
router.post('/:id/memberships', async (req, res) => {
  const result = await addMembership(pool, Number(req.params.id), req.body, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.membership)
})

router.delete('/:id/admins/:userId', async (req, res) => {
  const result = await removeAdmin(pool, Number(req.params.id), Number(req.params.userId))
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.post('/:id/archive', async (req, res) => {
  const result = await setArchived(pool, Number(req.params.id), true)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

router.post('/:id/unarchive', async (req, res) => {
  const result = await setArchived(pool, Number(req.params.id), false)
  if (result.error) return sendError(res, result.error)
  res.json(result.tenant)
})

export default router
