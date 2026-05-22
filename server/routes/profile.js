import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requireTenantAdmin } from '../middleware/tenant.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { validateAndReencodeImage } from '../utils/imageProcess.js'
import { normalizeOptionalUrl, PROFILE_LINK_PROTOCOLS } from '../utils/urls.js'

// Mollie API keys: live_<alphanum 25+> or test_<alphanum 25+>
const MOLLIE_KEY_RE = /^(live|test)_[A-Za-z0-9]{25,}$/

function maskMollieKey(key) {
  if (!key) return null
  const prefix = key.slice(0, 5)
  const last4 = key.slice(-4)
  const dots = '•'.repeat(Math.max(0, key.length - 9))
  return `${prefix}${dots}${last4}`
}

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

const FINANCIAL_FIELDS = [
  'formal_name',
  'address_street',
  'address_postal_code',
  'address_city',
  'address_country',
  'kvk_number',
  'iban',
  'tax_id',
  'tax_percentage',
  'applies_kor',
]

const FINANCIAL_FIELDS_SET = new Set(FINANCIAL_FIELDS)

const TEXT_MAX_LENGTHS = {
  formal_name: 200,
  address_street: 200,
  address_postal_code: 10,
  address_city: 200,
  address_country: 200,
}

const KVK_RE = /^[0-9]{8}$/
const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/
const TAX_ID_RE = /^NL[0-9]{9}B[0-9]{2}$/

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

// Get tenant profile with its links.
// mollie_api_key is intentionally excluded — use GET /profile/mollie-key for masked status.
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
  const { mollie_api_key: _omit, ...profile } = profiles[0]
  res.json({ ...profile, links })
})

function normalizeFinancialValue(key, raw) {
  if (key === 'applies_kor') {
    if (raw === null || raw === undefined) return { skip: true }
    if (typeof raw !== 'boolean') return { error: `invalid_${key}` }
    return { value: raw }
  }

  if (raw === null || raw === undefined) return { value: null }

  if (key === 'tax_percentage') {
    if (raw === '') return { skip: true }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { error: `invalid_${key}` }
    }
    return { value: n }
  }

  if (typeof raw !== 'string') return { error: `invalid_${key}` }

  if (key === 'kvk_number') {
    const stripped = raw.replace(/\s+/g, '')
    if (stripped === '') return { value: '' }
    if (!KVK_RE.test(stripped)) return { error: `invalid_${key}` }
    return { value: stripped }
  }

  if (key === 'iban') {
    const stripped = raw.replace(/\s+/g, '').toUpperCase()
    if (stripped === '') return { value: '' }
    if (!IBAN_RE.test(stripped)) return { error: `invalid_${key}` }
    return { value: stripped }
  }

  if (key === 'tax_id') {
    const stripped = raw.replace(/\s+/g, '').toUpperCase()
    if (stripped === '') return { value: '' }
    if (!TAX_ID_RE.test(stripped)) return { error: `invalid_${key}` }
    return { value: stripped }
  }

  const max = TEXT_MAX_LENGTHS[key]
  if (max != null && raw.length > max) return { error: `invalid_${key}` }
  return { value: raw }
}

// Update tenant profile (partial)
router.patch('/', async (req, res) => {
  const bodyKeys = Object.keys(req.body || {})
  const touchesFinancial = bodyKeys.some((k) => FINANCIAL_FIELDS_SET.has(k))
  if (touchesFinancial) {
    const isAdmin = req.membership?.role === 'tenant_admin' || req.user?.is_super_admin
    if (!isAdmin) return res.status(403).json({ error: 'tenant_admin_required' })
  }

  const fields = []
  const values = []
  let idx = 1

  for (const key of PROFILE_FIELDS) {
    if (key in req.body) {
      fields.push(`${key} = $${idx++}`)
      values.push(req.body[key])
    }
  }

  for (const key of FINANCIAL_FIELDS) {
    if (!(key in req.body)) continue
    const result = normalizeFinancialValue(key, req.body[key])
    if (result.error) return res.status(400).json({ error: result.error })
    if (result.skip) continue
    fields.push(`${key} = $${idx++}`)
    values.push(result.value)
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' })

  fields.push(`updated_at = NOW()`)
  values.push(req.tenantId)

  const { rows } = await pool.query(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  if (!rows.length) return res.status(404).json({ error: 'Profile not found' })
  const { mollie_api_key: _omit, ...updated } = rows[0]
  res.json(updated)
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

// Get Mollie API key status (returns masked preview, never the raw key)
router.get('/mollie-key', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT mollie_api_key FROM tenants WHERE id = $1',
    [req.tenantId],
  )
  const key = rows[0]?.mollie_api_key || null
  res.json({ isSet: !!key, preview: maskMollieKey(key) })
})

// Set or replace Mollie API key (tenant admin only)
router.put('/mollie-key', requireTenantAdmin, async (req, res) => {
  const { key } = req.body || {}
  if (typeof key !== 'string' || !MOLLIE_KEY_RE.test(key)) {
    return res.status(400).json({ error: 'invalid_mollie_key' })
  }
  const { rows } = await pool.query(
    'UPDATE tenants SET mollie_api_key = $1, updated_at = NOW() WHERE id = $2 RETURNING mollie_api_key',
    [key, req.tenantId],
  )
  const stored = rows[0]?.mollie_api_key
  res.json({ isSet: !!stored, preview: maskMollieKey(stored) })
})

// Clear Mollie API key (tenant admin only)
router.delete('/mollie-key', requireTenantAdmin, async (req, res) => {
  await pool.query(
    'UPDATE tenants SET mollie_api_key = NULL, updated_at = NOW() WHERE id = $1',
    [req.tenantId],
  )
  res.json({ isSet: false, preview: null })
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
