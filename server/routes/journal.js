import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/journalValidators.js'
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

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

// ---------- list ----------
router.get('/', async (req, res) => {
  const journals = await listJournals(pool, req.tenantId)
  res.json(journals)
})

// ---------- approve many (powers "Approve all") ----------
// Declared before '/:id' so 'approve' isn't parsed as an id.
router.post('/approve', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  const result = await approveMany(pool, req.tenantId, ids)
  res.json(result)
})

// ---------- create ----------
router.post('/', async (req, res) => {
  const result = await createJournal(pool, req.tenantId, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const { journal } = await getJournal(pool, req.tenantId, result.journalId)
  res.status(201).json(journal)
})

// ---------- single ----------
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await getJournal(pool, req.tenantId, id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.journal)
})

// ---------- patch (draft only) ----------
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await updateJournal(pool, req.tenantId, id, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const { journal } = await getJournal(pool, req.tenantId, id)
  res.json(journal)
})

// ---------- delete (draft only) ----------
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteJournal(pool, req.tenantId, id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(204).end()
})

// ---------- approve single ----------
router.post('/:id/approve', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await approveJournal(pool, req.tenantId, id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const { journal } = await getJournal(pool, req.tenantId, id)
  res.json(journal)
})

export default router
