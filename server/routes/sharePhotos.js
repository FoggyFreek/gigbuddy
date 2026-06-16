import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/sharePhotoValidators.js'
import { listPhotos, createPhoto, deletePhoto } from '../services/sharePhotoService.js'

const router = Router()

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  res.json(await listPhotos(pool, req.tenantId))
})

router.post('/', requirePermission(PERMISSIONS.TENANT_MANAGE), upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await createPhoto(pool, req.tenantId, req.file)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.photo)
})

router.delete('/:id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  const result = await deletePhoto(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
