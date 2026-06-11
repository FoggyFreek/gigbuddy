import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/accountValidators.js'
import {
  parseYearQuarter,
  validateReturnCreate,
  validatePayment,
} from '../validators/vatReturnValidators.js'
import {
  previewVatReturn,
  createVatReturn,
  recordVatPayment,
  listVatReturns,
  getVatReturn,
} from '../services/vatReturnService.js'

// Mounted under the tenantAdmin gate (see routes/index.js): filing returns and
// recording payments are tenant-admin actions. Filed returns are permanent —
// there is no DELETE.
const router = Router()

router.get('/preview', async (req, res, next) => {
  const period = parseYearQuarter(req.query)
  if (period.error) return res.status(400).json({ error: period.error })
  try {
    const result = await previewVatReturn(pool, req.tenantId, period)
    if (result.error) return res.status(result.error.status).json(result.error.body)
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

router.post('/', async (req, res, next) => {
  const body = validateReturnCreate(req.body || {})
  if (body.error) return res.status(400).json({ error: body.error })
  try {
    const result = await createVatReturn(pool, req.tenantId, body, req.user.id)
    if (result.error) return res.status(result.error.status).json(result.error.body)
    res.status(201).json(result.vatReturn)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  try {
    const vatReturn = await getVatReturn(pool, req.tenantId, id)
    if (!vatReturn) return res.status(404).json({ error: 'Not found' })
    res.json(vatReturn)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/payments', async (req, res, next) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const payment = validatePayment(req.body || {})
  if (payment.error) return res.status(400).json({ error: payment.error })
  try {
    const result = await recordVatPayment(pool, req.tenantId, id, payment, req.user.id)
    if (result.error) return res.status(result.error.status).json(result.error.body)
    res.status(201).json(result.payment)
  } catch (err) {
    next(err)
  }
})

export default router
