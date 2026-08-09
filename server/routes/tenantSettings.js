import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { sendError } from './routeHelpers.js'
import { changeTenantSlug } from '../services/tenantSettingsService.js'

const router = Router()

router.patch('/slug', async (req, res) => {
  const result = await changeTenantSlug(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, result.audit.action)
  res.json({ slug: result.slug })
})

export default router
