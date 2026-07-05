// Super-admin subscription management. Mounted at /api/admin/subscriptions
// behind the superAdmin gate (see routes/index.js). Complimentary grants and
// the operator listing with repair/stale alerts.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import {
  listSubscriptions,
  grantComplimentary,
  revokeComplimentary,
} from '../services/adminSubscriptionService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

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

router.post('/:userId/revoke-complimentary', async (req, res) => {
  const userId = Number(req.params.userId)
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid userId' })
  const result = await revokeComplimentary(pool, userId)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'billing.complimentary_revoke', { targetUserId: userId })
  res.json(result)
})

export default router
