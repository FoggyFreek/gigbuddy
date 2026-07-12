// Finance-onboarding endpoints. Mounted under the finance-gated group
// (/finance-onboarding): reads need finance.view (the mount), the opening-balance
// write additionally requires finance.manage. (Tutorial dismissal is generic and
// lives at /api/tutorials.)
import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { sendError } from './routeHelpers.js'
import { parseOpeningBalanceBody } from '../validators/financeOnboardingValidators.js'
import { getStatus, setOpeningBalance } from '../services/financeOnboardingService.js'

const router = Router()

// ---------- GET /api/finance-onboarding/status ----------
router.get('/status', async (req, res, next) => {
  try {
    res.json(await getStatus(pool, req.tenantId))
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/finance-onboarding/opening-balance ----------
router.post('/opening-balance', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const parsed = parseOpeningBalanceBody(req.body || {})
  if (parsed.error) return sendError(res, parsed.error)
  try {
    const result = await setOpeningBalance(pool, req.tenantId, parsed, req.user.id)
    if (result.error) return sendError(res, result.error)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
