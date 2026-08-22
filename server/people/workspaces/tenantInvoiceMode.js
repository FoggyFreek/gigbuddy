import { Router } from 'express'
import pool from '../../db/index.js'
import { requirePermission } from '../../middleware/permissions.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import { getTenantInvoiceMode, setTenantInvoiceMode } from './tenantInvoiceModeService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await getTenantInvoiceMode(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json({ preferred_invoice_mode: result.preferredInvoiceMode })
})

router.patch('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await setTenantInvoiceMode(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json({ preferred_invoice_mode: result.preferredInvoiceMode })
})

export default router
