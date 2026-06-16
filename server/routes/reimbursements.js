import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/journalValidators.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'
import {
  listReimbursements,
  fetchReimbursementPeriods,
} from '../repositories/reimbursementRepository.js'
import {
  listOutstanding,
  listMemberOutstandingPurchases,
  createReimbursement,
  reimburseMemberFull,
} from '../services/reimbursementService.js'

const router = Router()

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

// ---------- outstanding (grouped by band member) ----------
router.get('/outstanding', async (req, res) => {
  const result = await listOutstanding(pool, req.tenantId)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.items)
})

// ---------- a member's unsettled member-paid purchases ----------
router.get('/members/:id/purchases', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await listMemberOutstandingPurchases(pool, req.tenantId, id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.items)
})

// ---------- register a reimbursement ----------
router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await createReimbursement(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.reimbursement)
})

// ---------- reimburse a member's full outstanding balance ----------
router.post('/members/:id/full', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await reimburseMemberFull(pool, req.tenantId, id, req.body || {}, req.user.id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.reimbursement)
})

// ---------- history ----------
router.get('/', async (req, res) => {
  const period = buildPeriodWhere(req.query, 'r.paid_on')
  if (period.error) return res.status(400).json({ error: period.error })
  const rows = await listReimbursements(pool, req.tenantId, period)
  res.json(rows)
})

router.get('/periods', async (req, res) => {
  const dates = await fetchReimbursementPeriods(pool, req.tenantId)
  res.json(dates)
})

export default router
