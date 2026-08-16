// User-facing billing endpoints. Mounted at /api/billing behind requireApproved
// (see app/apiRouter.js) — billing is user-level, not tenant-scoped, so no active
// tenant is resolved. The subscription owner acts here regardless of which band
// is active.
//
// One subscription per user, made of modules, so nothing here takes an
// `audience` to say WHICH subscription — only to say which module.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { requireCurrentTerms } from '../../middleware/auth.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import {
  getBillingState,
  startTrial,
  subscribe,
  checkout,
  changeModule,
  previewModuleChange,
  cancelSubscription,
  resumeSubscription,
  downgrade,
  previewDowngrade,
  syncOwnSubscription,
} from './billingService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await getBillingState(pool, req.user.id))
})

// Start the free trial: 30 days, Gold only, one starter module, no payment and
// no provider schedule.
router.post('/trial', requireCurrentTerms, async (req, res) => {
  const result = await startTrial(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.trial_started', { subscriptionId: result.subscription.id })
  res.status(201).json(result)
})

// Direct signup for a customer whose trial is already spent.
router.post('/subscribe', requireCurrentTerms, async (req, res) => {
  const result = await subscribe(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.subscribe', { subscriptionId: result.subscriptionId })
  res.status(201).json(result)
})

// Trial continuation: price the module set, verify the mandate for €0.01 now,
// and schedule the first combined subscription charge at trial_ends_at.
router.post('/checkout', requireCurrentTerms, async (req, res) => {
  const result = await checkout(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.checkout', { subscriptionId: result.subscriptionId })
  res.status(201).json(result)
})

// What adding or upgrading a module would cost right now — the UI must never
// ask for a confirmation whose price the user has not seen.
router.post('/modules/preview', requireCurrentTerms, async (req, res) => {
  const result = await previewModuleChange(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Add a module, or move one UP. Free during a trial; on a paid cycle it charges
// the prorated difference and preserves the renewal date.
router.post('/modules', requireCurrentTerms, async (req, res) => {
  const result = await changeModule(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.module_change', { audience: req.body?.audience, planId: req.body?.planId })
  res.json(result)
})

// Read-only downgrade preview for the confirm dialog (features/data to be
// removed, binding limit snapshot, capacity blockers).
router.post('/downgrade/preview', requireCurrentTerms, async (req, res) => {
  const result = await previewDowngrade(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Lower a module's plan, or remove it altogether. Type-to-confirm; takes effect
// at the period boundary, and only then is anything purged.
router.post('/downgrade', requireCurrentTerms, async (req, res) => {
  const result = await downgrade(pool, req.user, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.downgrade_scheduled', {
    audience: req.body?.audience, planId: req.body?.planId,
  })
  res.json(result)
})

// `immediate: true` is the withdrawal path — inside the five-day window it ends
// access now and refunds the charge that opened the period, in full.
router.post('/cancel', requireCurrentTerms, async (req, res) => {
  const result = await cancelSubscription(pool, req.user.id, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.cancel', { immediate: req.body?.immediate === true })
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
