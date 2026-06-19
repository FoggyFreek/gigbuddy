import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/reimbursementValidators.js'
import {
  listOutstanding,
  listMemberOutstandingPurchases,
  listReimbursementHistory,
  listReimbursementPeriods,
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
  const result = await listReimbursementHistory(pool, req.tenantId, req.query)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.reimbursements)
})

router.get('/periods', async (req, res) => {
  const result = await listReimbursementPeriods(pool, req.tenantId)
  res.json(result.dates)
})

export default router
