// Super-admin subscription management. Mounted at /api/admin/subscriptions
// behind the superAdmin gate (see app/apiRouter.js). Complimentary grants and
// the operator listing with repair/stale alerts.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import {
  listSubscriptions,
  grantComplimentary,
  revokeComplimentary,
  refundSubscription,
  listSubscriptionRefunds,
} from './adminSubscriptionService.js'
import { requireParam } from '../../platform/http/routeHelpers.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listSubscriptions(pool, { repairOnly: req.query?.repair === '1' }))
})

router.post('/complimentary', async (req, res) => {
  const result = await grantComplimentary(pool, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.complimentary_grant', {
    targetUserId: Number(req.body?.userId),
    planId: result.subscription.planId,
    subscriptionId: result.subscription.id,
  })
  res.status(201).json(result.subscription)
})

// Partial refunds for support cases agreed out of band (email, support desk).
// The subscription itself is left running.
router.get('/:id/refunds', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listSubscriptionRefunds(pool, id)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/:id/refunds', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await refundSubscription(pool, id, req.body ?? {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.admin_refund', {
    subscriptionId: id, amountCents: Number(req.body?.amountCents),
  })
  res.status(201).json(result)
})

// The body names the subscription so an id from another account cannot be
// revoked through the wrong URL.
router.post('/:userId/revoke-complimentary', async (req, res) => {
  const userId = Number(req.params.userId)
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid userId' })
  const result = await revokeComplimentary(pool, userId, Number(req.body?.subscriptionId))
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.complimentary_revoke', {
    targetUserId: userId, subscriptionId: Number(req.body?.subscriptionId),
  })
  res.json(result)
})

export default router
