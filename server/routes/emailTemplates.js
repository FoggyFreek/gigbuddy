import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/emailTemplateValidators.js'
import {
  listEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  patchEmailTemplate,
  deleteEmailTemplate,
} from '../services/emailTemplateService.js'

const router = Router()

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  res.json(await listEmailTemplates(pool, req.tenantId))
})

router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await getEmailTemplate(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})

router.post('/', async (req, res) => {
  const result = await createEmailTemplate(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.template)
})

router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await patchEmailTemplate(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.template)
})

router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await deleteEmailTemplate(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
