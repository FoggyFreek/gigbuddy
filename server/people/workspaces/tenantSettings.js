import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import { changeTenantSlug } from './tenantSettingsService.js'

const router = Router()

router.patch('/slug', async (req, res) => {
  const result = await changeTenantSlug(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action)
  res.json({
    slug: result.slug,
    ...(result.linkpageSync ? { linkpageSync: result.linkpageSync } : {}),
  })
})

export default router
