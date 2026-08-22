import { Router } from 'express'
import pool from '../../db/index.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { requirePermission } from '../../middleware/permissions.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { generateContract, listContracts } from './contractService.js'

const router = Router({ mergeParams: true })
router.get('/', requirePermission(PERMISSIONS.FINANCE_VIEW), async (req, res) => {
  const gigId = requireParam(req, res, 'gigId'); if (gigId === null) return
  const result = await listContracts(pool, req.tenantId, gigId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})
router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const gigId = requireParam(req, res, 'gigId'); if (gigId === null) return
  const result = await generateContract(pool, req.tenantId, req.user.id, gigId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.contract)
})
export default router
