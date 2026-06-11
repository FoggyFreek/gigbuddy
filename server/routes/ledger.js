// Read-only ledger browser endpoints. Posting stays in ledgerService.js,
// driven by the invoice/purchase/journal/reimbursement state machines.
import { Router } from 'express'
import pool from '../db/index.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'
import { parseId } from '../validators/journalValidators.js'
import { listEntryDates } from '../repositories/ledgerRepository.js'
import { getLedgerList, getLedgerEntryDetail } from '../services/ledgerService.js'

const router = Router()

// ---------- list ----------
router.get('/', async (req, res) => {
  const period = buildPeriodWhere(req.query, 'lt.entry_date')
  if (period.error) return res.status(400).json({ error: period.error })
  res.json(await getLedgerList(pool, req.tenantId, period))
})

// ---------- periods (for the PeriodPicker availability grid) ----------
router.get('/periods', async (req, res) => {
  res.json(await listEntryDates(pool, req.tenantId))
})

// ---------- detail ----------
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const detail = await getLedgerEntryDetail(pool, req.tenantId, id)
  if (!detail) return res.status(404).json({ error: 'Not found' })
  res.json(detail)
})

export default router
