import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requireTenantAdmin } from '../middleware/tenant.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { validateAndReencodeImage } from '../utils/imageProcess.js'
import { normalizeOptionalUrl, PROFILE_LINK_PROTOCOLS } from '../utils/urls.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

const PROFILE_FIELDS = [
  'band_name',
  'bio',
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
  'bandsintown_artist_name',
  'accent_color',
]

const LINK_FIELDS = ['label', 'url', 'sort_order']

function normalizeRequiredProfileUrl(value) {
  const url = normalizeOptionalUrl(value, { allowedProtocols: PROFILE_LINK_PROTOCOLS })
  if (!url) {
    const err = new Error('Invalid URL')
    err.status = 400
    throw err
  }
  return url
}

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireLinkId(req, res) {
  const linkId = parseId(req.params.linkId)
  if (linkId === null) {
    res.status(400).json({ error: 'Invalid linkId' })
    return null
  }
  return linkId
}

// Get tenant profile with its links
router.get('/', async (req, res) => {
  const { rows: profiles } = await pool.query(
    'SELECT * FROM tenants WHERE id = $1',
    [req.tenantId],
  )
  if (!profiles.length) return res.status(404).json({ error: 'Profile not found' })

  const { rows: links } = await pool.query(
    'SELECT * FROM profile_links WHERE tenant_id = $1 ORDER BY sort_order ASC, id ASC',
    [req.tenantId],
  )
  res.json({ ...profiles[0], links })
})

// Update tenant profile (partial)
router.patch('/', async (req, res) => {
  const fields = []
  const values = []
  let idx = 1

  for (const key of PROFILE_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)
  values.push(req.tenantId)

  const { rows } = await pool.query(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Profile not found' })
  res.json(rows[0])
})

// Create link
router.post('/links', async (req, res) => {
  const { label, url } = req.body
  if (!label || !url) {
    return res.status(400).json({ error: 'label and url are required' })
  }
  const normalizedUrl = normalizeRequiredProfileUrl(url)

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profile_links WHERE tenant_id = $1',
    [req.tenantId],
  )
  const nextOrder = maxRows[0].next

  const { rows } = await pool.query(
    `INSERT INTO profile_links (tenant_id, label, url, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.tenantId, label, normalizedUrl, nextOrder],
  )
  res.status(201).json(rows[0])
})

// Update link (partial)
router.patch('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return

  const fields = []
  const values = []
  let idx = 1

  for (const key of LINK_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(
        key === 'url'
          ? normalizeRequiredProfileUrl(req.body[key])
          : req.body[key],
      )
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  values.push(linkId, req.tenantId)
  const { rows } = await pool.query(
    `UPDATE profile_links SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  res.json(rows[0])
})

// Delete link
router.delete('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return
  const { rowCount } = await pool.query(
    'DELETE FROM profile_links WHERE id = $1 AND tenant_id = $2',
    [linkId, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

// Upload / replace band logo (tenant admin only)
router.post('/logo', requireTenantAdmin, logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!LOGO_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }

  const image = await validateAndReencodeImage(req.file.buffer, req.file.mimetype)

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const objectKey = `tenants/${req.tenantId}/logo/${randomUUID()}${ext}`

  const { rows: before } = await pool.query(
    'SELECT logo_path FROM tenants WHERE id = $1',
    [req.tenantId],
  )
  const oldKey = before[0]?.logo_path || null

  await storageClient.putObject(BUCKET, objectKey, image.buffer, image.size, {
    'Content-Type': image.mimetype,
  })

  let updatedKey
  try {
    const { rows } = await pool.query(
      'UPDATE tenants SET logo_path = $1, updated_at = NOW() WHERE id = $2 RETURNING logo_path',
      [objectKey, req.tenantId],
    )
    updatedKey = rows[0].logo_path
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }

  if (oldKey) {
    storageClient.removeObject(BUCKET, oldKey).catch((e) =>
      console.warn('Failed to delete old logo object:', e.message),
    )
  }

  res.json({ logo_path: updatedKey })
})

export default router
