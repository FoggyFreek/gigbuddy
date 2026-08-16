import { Router } from 'express'
import pool from '../../db/index.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import {
  getOperationsSummary,
  listBillingOperationAlerts,
  listStatusDriftAlerts,
  listWebhookFailureAlerts,
} from './adminOperationService.js'

const router = Router()

router.get('/summary', async (_req, res) => {
  res.json(await getOperationsSummary(pool))
})

router.get('/billing-operations', async (req, res) => {
  const result = await listBillingOperationAlerts(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/webhook-failures', async (req, res) => {
  const result = await listWebhookFailureAlerts(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/status-drift', async (req, res) => {
  const result = await listStatusDriftAlerts(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
