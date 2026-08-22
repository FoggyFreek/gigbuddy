import { Router } from 'express'
import pool from '../../db/index.js'
import templatesRouter from './templates.js'
import campaignsRouter from './campaigns.js'
import contractsRouter from './contracts.js'
import { requirePermission } from '../../middleware/permissions.js'
import { requireEntitlement } from '../../middleware/entitlements.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { FEATURES } from '../../auth/entitlements.js'
import { configureOutreachSender, getOutreachSender } from './senderService.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import { listOutreachFields } from './templateService.js'
import { getOutreachImages } from './imageService.js'

const router = Router()
router.get('/fields', async (req, res) => {
  const result = await listOutreachFields(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.fields)
})
router.get('/images', async (req, res) => {
  const result = await getOutreachImages(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.images)
})
router.use('/templates', templatesRouter)
router.get('/sender', async (req, res) => {
  const result = await getOutreachSender(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.sender)
})
router.put('/sender', requireEntitlement(FEATURES.OUTREACH), requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const result = await configureOutreachSender(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.sender)
})
router.use('/campaigns', campaignsRouter)
router.use('/contracts', contractsRouter)

export default router
