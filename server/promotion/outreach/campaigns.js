import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import pool from '../../db/index.js'
import { FEATURES } from '../../auth/entitlements.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { requireEntitlement } from '../../middleware/entitlements.js'
import { requirePermission } from '../../middleware/permissions.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { getResendClientForTenant } from '../../platform/integrations/resendService.js'
import { createBatchDispatcher } from './dispatch/index.js'
import { createCampaign, getCampaign, listCampaigns, sendCampaign } from './campaignService.js'
import { addSuppression, deleteSuppression, listSuppressions } from './suppressionService.js'

const router = Router()
const outreachWrite = requireEntitlement(FEATURES.OUTREACH)
const planningWrite = requirePermission(PERMISSIONS.PLANNING_WRITE)
const caller = (req) => ({ role: req.membership?.role, isSuperAdmin: Boolean(req.user?.is_super_admin) })
const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `tenant:${req.tenantId}`,
})

// Static routes must precede /:id or Express treats "suppressions" as an id.
router.get('/suppressions/list', planningWrite, async (req, res) => {
  const result = await listSuppressions(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})
router.post('/suppressions/list', outreachWrite, planningWrite, async (req, res) => {
  const result = await addSuppression(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.suppression)
})
router.delete('/suppressions/list/:id', outreachWrite, planningWrite, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteSuppression(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.get('/', async (req, res) => {
  const result = await listCampaigns(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getCampaign(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.campaign)
})
router.post('/', outreachWrite, planningWrite, async (req, res) => {
  const result = await createCampaign(pool, req.tenantId, req.user.id, req.body, caller(req))
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.campaign)
})
router.post('/:id/send', sendLimiter, outreachWrite, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const clientResult = await getResendClientForTenant(pool, req.tenantId)
  if (clientResult.error) return sendError(res, clientResult.error)
  const result = await sendCampaign(pool, req.tenantId, id, caller(req), {
    batchDispatcher: createBatchDispatcher(clientResult.resend),
  })
  if (result.error) return sendError(res, result.error)
  res.json(result.campaign)
})

export default router
