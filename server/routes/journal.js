import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listJournals,
  getJournal,
  createJournal,
  updateJournal,
  deleteJournal,
  approveJournal,
  approveMany,
} from '../services/journalService.js'

const router = Router()

// ---------- list ----------
router.get('/', async (req, res) => {
  const journals = await listJournals(pool, req.tenantId)
  res.json(journals)
})

// ---------- approve many (powers "Approve all") ----------
// Declared before '/:id' so 'approve' isn't parsed as an id.
router.post('/approve', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  const result = await approveMany(pool, req.tenantId, ids, req.user.id)
  res.json(result)
})

// ---------- create ----------
router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await createJournal(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  const { journal } = await getJournal(pool, req.tenantId, result.journalId)
  res.status(201).json(journal)
})

// ---------- single ----------
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getJournal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.journal)
})

// ---------- patch (draft only) ----------
router.patch('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await updateJournal(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  const { journal } = await getJournal(pool, req.tenantId, id)
  res.json(journal)
})

// ---------- delete (draft only) ----------
router.delete('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteJournal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- approve single ----------
router.post('/:id/approve', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await approveJournal(pool, req.tenantId, id, req.user.id)
  if (result.error) return sendError(res, result.error)
  const { journal } = await getJournal(pool, req.tenantId, id)
  res.json(journal)
})

export default router
