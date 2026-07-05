// User-facing billing endpoints. Mounted at /api/billing behind requireApproved
// (see routes/index.js) — billing is user-level, not tenant-scoped, so no active
// tenant is resolved. The subscription owner acts here regardless of which band
// is active.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { listPlans } from '../services/planService.js'
import {
  getBillingState,
  subscribe,
  cancelSubscription,
  resumeSubscription,
  changePlan,
  downgrade,
  syncOwnSubscription,
} from '../services/billingService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  const [state, plans] = await Promise.all([
    getBillingState(pool, req.user.id),
    listPlans(pool),
  ])
  res.json({ ...state, plans: plans.filter((p) => p.is_active) })
})

router.post('/subscribe', async (req, res) => {
  const result = await subscribe(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.subscribe', { subscriptionId: result.subscriptionId })
  res.status(201).json({ checkoutUrl: result.checkoutUrl, trial: result.trial })
})

router.post('/change-plan', async (req, res) => {
  const result = await changePlan(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.plan_change', { interval: req.body?.interval })
  res.json(result)
})

router.post('/downgrade', async (req, res) => {
  const result = await downgrade(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/cancel', async (req, res) => {
  const result = await cancelSubscription(pool, req.user.id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.cancel', {})
  res.json(result)
})

router.post('/resume', async (req, res) => {
  const result = await resumeSubscription(pool, req.user.id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.resume', {})
  res.json(result)
})

// Manual reconcile (dev, when webhooks are disabled).
router.post('/sync', async (req, res) => {
  res.json(await syncOwnSubscription(pool, req.user.id))
})

export default router
