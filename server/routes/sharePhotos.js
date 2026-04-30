import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requireAdmin } from '../middleware/auth.js'
import { storageClient, BUCKET } from '../utils/storage.js'

const router = Router()

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, object_key, content_type, label, sort_order FROM share_photos ORDER BY sort_order, id'
  )
  res.json(rows)
})

router.post('/', requireAdmin, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const objectKey = `share/${randomUUID()}${ext}`
  const label = path.basename(req.file.originalname, ext) || 'Photo'

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM share_photos'
  )
  const sortOrder = maxRows[0].next

  await storageClient.putObject(BUCKET, objectKey, req.file.buffer, req.file.size, {
    'Content-Type': req.file.mimetype,
  })

  let row
  try {
    const { rows } = await pool.query(
      `INSERT INTO share_photos (object_key, content_type, label, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [objectKey, req.file.mimetype, label, sortOrder]
    )
    row = rows[0]
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }

  res.status(201).json(row)
})

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' })

  const { rows } = await pool.query('SELECT object_key FROM share_photos WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Not found' })

  const { object_key } = rows[0]

  const { rowCount } = await pool.query('DELETE FROM share_photos WHERE id = $1', [id])
  if (!rowCount) return res.status(404).json({ error: 'Not found' })

  storageClient.removeObject(BUCKET, object_key).catch((e) =>
    console.warn('Failed to delete share photo object:', e.message)
  )

  res.status(204).end()
})

export default router
