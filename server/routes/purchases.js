import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { parseId } from '../validators/purchaseValidators.js'
import {
  createPurchase,
  applyPurchasePatch,
  registerPayment,
  createPurchaseAttachment,
  listPurchases,
  listPeriods,
  getPurchaseDetail,
  deletePurchase,
  deletePurchaseAttachment,
} from '../services/purchaseService.js'

const router = Router()

const ATTACHMENT_ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

function requireParam(req, res, name, label = name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: `Invalid ${label}` })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// ---------- list ----------
router.get('/', async (req, res) => {
  const result = await listPurchases(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.purchases)
})

router.get('/periods', async (req, res) => {
  res.json(await listPeriods(pool, req.tenantId))
})

// ---------- single ----------
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getPurchaseDetail(pool, req.tenantId, id, { withAttachments: true })
  if (result.error) return sendError(res, result.error)
  res.json(result.purchase)
})

// ---------- attachments ----------
router.post('/:id/attachments', attachmentUpload.single('file'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!ATTACHMENT_ALLOWED_TYPES.has(req.file.mimetype))
    return res.status(400).json({ error: 'File type not allowed' })

  const result = await createPurchaseAttachment({ db: pool, tenantId: req.tenantId, purchaseId: id, file: req.file })
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.attachment)
})

router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const attachmentId = requireParam(req, res, 'attachmentId'); if (attachmentId === null) return
  const result = await deletePurchaseAttachment(pool, req.tenantId, id, attachmentId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- create ----------
router.post('/', async (req, res) => {
  const result = await createPurchase(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  const detail = await getPurchaseDetail(pool, req.tenantId, result.purchaseId)
  res.status(201).json(detail.purchase)
})

// ---------- patch ----------
router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await applyPurchasePatch(pool, req.tenantId, id, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  const detail = await getPurchaseDetail(pool, req.tenantId, id)
  res.json(detail.purchase)
})

// ---------- delete (draft only) ----------
router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deletePurchase(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- register payment ----------
router.post('/:id/payment', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await registerPayment(pool, req.tenantId, id, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  const detail = await getPurchaseDetail(pool, req.tenantId, id)
  res.json(detail.purchase)
})

export default router
