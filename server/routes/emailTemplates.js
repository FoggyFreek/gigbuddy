import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  patchEmailTemplate,
  deleteEmailTemplate,
} from '../services/emailTemplateService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listEmailTemplates(pool, req.tenantId))
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getEmailTemplate(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createEmailTemplate(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.template)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchEmailTemplate(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteEmailTemplate(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
