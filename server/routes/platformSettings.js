import { Router } from 'express'
import pool from '../db/index.js'
import { setTenantOnboardingEnabled } from '../services/platformSettingsService.js'
import { auditLog } from '../utils/auditLog.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.patch('/tenant-onboarding', async (req, res) => {
  const result = await setTenantOnboardingEnabled(pool, req.body, req.user.id)
  if (result.error) return sendError(res, result.error)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  res.json({
    tenantOnboardingEnabled: result.settings.tenantOnboardingEnabled,
  })
})

export default router
