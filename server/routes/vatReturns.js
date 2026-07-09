import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import {
  parseYearQuarter,
  validateReturnCreate,
  validatePayment,
} from '../validators/vatReturnValidators.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  previewVatReturn,
  createVatReturn,
  recordVatPayment,
  listVatReturns,
  getVatReturn,
} from '../services/vatReturnService.js'

// Mounted under the financeView gate (see routes/index.js): reads require
// finance.view and the filing/payment mutations require finance.manage. Filed
// returns are permanent — there is no DELETE.
const router = Router()

router.get('/preview', async (req, res, next) => {
  const period = parseYearQuarter(req.query)
  if (period.error) return res.status(400).json({ error: period.error })
  try {
    const result = await previewVatReturn(pool, req.tenantId, period)
    if (result.error) return sendError(res, result.error)
    res.json(result.preview)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    res.json(await listVatReturns(pool, req.tenantId))
  } catch (err) {
    next(err)
  }
})

router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const body = validateReturnCreate(req.body || {})
  if (body.error) return res.status(400).json({ error: body.error })
  try {
    const result = await createVatReturn(pool, req.tenantId, body, req.user.id)
    if (result.error) return sendError(res, result.error)
    res.status(201).json(result.vatReturn)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  try {
    const vatReturn = await getVatReturn(pool, req.tenantId, id)
    if (!vatReturn) return res.status(404).json({ error: 'Not found' })
    res.json(vatReturn)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/payments', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const payment = validatePayment(req.body || {})
  if (payment.error) return res.status(400).json({ error: payment.error })
  try {
    const result = await recordVatPayment(pool, req.tenantId, id, payment, req.user.id)
    if (result.error) return sendError(res, result.error)
    res.status(201).json(result.payment)
  } catch (err) {
    next(err)
  }
})

export default router
