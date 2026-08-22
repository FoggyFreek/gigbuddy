import { Router } from 'express'
import pool from '../../db/index.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { requirePermission } from '../../middleware/permissions.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { countersignContract, getContract, getContractPdf, voidContract } from './contractService.js'

const router = Router()
const financeView = requirePermission(PERMISSIONS.FINANCE_VIEW)
const financeManage = requirePermission(PERMISSIONS.FINANCE_MANAGE)

router.get('/:id', financeView, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getContract(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.contract)
})
router.get('/:id/pdf', financeView, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getContractPdf(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="contract-${result.contract.reference}.pdf"`)
  result.stream.on('error', (err) => res.destroy(err))
  result.stream.pipe(res)
})
router.post('/:id/countersign', financeManage, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await countersignContract(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.contract)
})
router.post('/:id/void', financeManage, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await voidContract(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.contract)
})
export default router
