// User-facing billing endpoints. Mounted at /api/billing behind requireApproved
// (see routes/index.js) — billing is user-level, not tenant-scoped, so no active
// tenant is resolved. The subscription owner acts here regardless of which band
// is active.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireCurrentTerms } from '../middleware/auth.js'
import { sendError } from './routeHelpers.js'
import { listPlans } from '../services/planService.js'
import {
  getBillingState,
  subscribe,
  cancelSubscription,
  resumeSubscription,
  changePlan,
  downgrade,
  previewDowngrade,
  syncOwnSubscription,
} from '../services/billingService.js'

const router = Router()

router.get('/', async (req, res) => {
  const [state, plans] = await Promise.all([
    getBillingState(pool, req.user.id),
    listPlans(pool),
  ])
  res.json({ ...state, plans: plans.filter((p) => p.is_active) })
})

router.post('/subscribe', requireCurrentTerms, async (req, res) => {
  const result = await subscribe(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.subscribe', { subscriptionId: result.subscriptionId })
  res.status(201).json({ checkoutUrl: result.checkoutUrl, trial: result.trial })
})

router.post('/change-plan', requireCurrentTerms, async (req, res) => {
  const result = await changePlan(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.plan_change', { interval: req.body?.interval })
  res.json(result)
})

// Read-only downgrade preview for the confirm dialog (features/data to be
// removed, binding limit snapshot, capacity blockers).
router.post('/downgrade/preview', requireCurrentTerms, async (req, res) => {
  const result = await previewDowngrade(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/downgrade', requireCurrentTerms, async (req, res) => {
  const result = await downgrade(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.downgrade_scheduled', { planId: req.body?.planId, interval: req.body?.interval })
  res.json(result)
})

router.post('/cancel', requireCurrentTerms, async (req, res) => {
  const result = await cancelSubscription(pool, req.user.id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.cancel', {})
  res.json(result)
})

router.post('/resume', requireCurrentTerms, async (req, res) => {
  const result = await resumeSubscription(pool, req.user.id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.resume', {})
  res.json(result)
})

// Manual reconcile (dev, when webhooks are disabled).
router.post('/sync', requireCurrentTerms, async (req, res) => {
  res.json(await syncOwnSubscription(pool, req.user.id))
})

export default router
