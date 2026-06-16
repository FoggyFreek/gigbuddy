import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/accountValidators.js'
import {
  getSettings,
  patchSettings,
  listAccounts,
  createAccount,
  patchAccount,
  deleteAccount,
} from '../services/accountService.js'

const router = Router()

function requireParam(req, res, name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// ---------- GET /api/accounts/settings ----------
// Must be declared before /:id so Express doesn't treat "settings" as an id.
router.get('/settings', async (req, res, next) => {
  try {
    const result = await getSettings(pool, req.tenantId)
    res.json(result.settings)
  } catch (err) {
    next(err)
  }
})

// ---------- PATCH /api/accounts/settings ----------
router.patch('/settings', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  try {
    const result = await patchSettings(req.tenantId, req.body || {})
    if (result.error) return sendError(res, result.error)
    res.json(result.settings)
  } catch (err) {
    next(err)
  }
})

// ---------- GET /api/accounts ----------
router.get('/', async (req, res, next) => {
  try {
    res.json(await listAccounts(pool, req.tenantId))
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/accounts ----------
router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  try {
    const result = await createAccount(pool, req.tenantId, req.body || {})
    if (result.error) return sendError(res, result.error)
    res.status(201).json(result.account)
  } catch (err) {
    next(err)
  }
})

// ---------- PATCH /api/accounts/:id ----------
router.patch('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  try {
    const result = await patchAccount(pool, req.tenantId, id, req.body || {})
    if (result.error) return sendError(res, result.error)
    res.json(result.account)
  } catch (err) {
    next(err)
  }
})

// ---------- DELETE /api/accounts/:id ----------
router.delete('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  try {
    const result = await deleteAccount(pool, req.tenantId, id)
    if (result.error) return sendError(res, result.error)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
