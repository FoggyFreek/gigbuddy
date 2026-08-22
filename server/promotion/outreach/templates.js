import { Router } from 'express'
import pool from '../../db/index.js'
import { requireEntitlement } from '../../middleware/entitlements.js'
import { FEATURES } from '../../auth/entitlements.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { copyOutreachTemplate, createOutreachTemplate, deleteOutreachTemplate, getOutreachTemplate, listOutreachTemplates, patchOutreachTemplate } from './templateService.js'

const router = Router()
const outreachWrite = requireEntitlement(FEATURES.OUTREACH)
const caller = (req) => ({ role: req.membership?.role, isSuperAdmin: Boolean(req.user?.is_super_admin) })

router.get('/', async (req, res) => {
  const result = await listOutreachTemplates(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getOutreachTemplate(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})
router.post('/', outreachWrite, async (req, res) => {
  const result = await createOutreachTemplate(pool, req.tenantId, req.body, caller(req))
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.template)
})
router.post('/:id/copy', outreachWrite, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await copyOutreachTemplate(pool, req.tenantId, id, caller(req))
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.template)
})
router.patch('/:id', outreachWrite, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchOutreachTemplate(pool, req.tenantId, id, req.body, caller(req))
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})
router.delete('/:id', outreachWrite, async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteOutreachTemplate(pool, req.tenantId, id, caller(req))
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
