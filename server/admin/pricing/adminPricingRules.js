// Super-admin CRUD for the pricing rule catalog. Mounted at
// /api/admin/pricing-rules behind the superAdmin gate (see app/apiRouter.js).
//
// Note the shape: rules are edited by SUPERSEDING them (POST /:id/versions),
// not by patching what they charge, so a stored price snapshot always resolves
// back to the exact terms it was priced with.
import { Router } from 'express'
import pool from '../../db/index.js'
import { auditLog } from '../../utils/auditLog.js'
import {
  listPricingRules,
  createPricingRule,
  createPricingRuleVersion,
  updatePricingRule,
} from '../../commerce/pricing/pricingRuleService.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'

const router = Router()

router.get('/', async (_req, res) => {
  res.json(await listPricingRules(pool))
})

router.post('/', async (req, res) => {
  const result = await createPricingRule(pool, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.pricingRule.create', {
    pricingRuleId: result.rule.id, pricingRuleCode: result.rule.code,
  })
  res.status(201).json(result.rule)
})

router.post('/:id/versions', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await createPricingRuleVersion(pool, id, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.pricingRule.version', {
    pricingRuleId: result.rule.id, pricingRuleCode: result.rule.code,
  })
  res.status(201).json(result.rule)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await updatePricingRule(pool, id, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.pricingRule.update', {
    pricingRuleId: result.rule.id, pricingRuleCode: result.rule.code,
  })
  res.json(result.rule)
})

export default router
