import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/profileValidators.js'
import {
  getProfile,
  patchProfile,
  createLink,
  patchLink,
  deleteLink,
  getMollieKeyStatus,
  setMollieKeyValue,
  clearMollieKeyValue,
  uploadLogo,
} from '../services/profileService.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

function requireLinkId(req, res) {
  const linkId = parseId(req.params.linkId)
  if (linkId === null) {
    res.status(400).json({ error: 'Invalid linkId' })
    return null
  }
  return linkId
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// Get tenant profile with its links.
router.get('/', async (req, res) => {
  const result = await getProfile(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.profile)
})

// Update tenant profile (partial)
router.patch('/', async (req, res) => {
  const isAdmin = req.membership?.role === 'tenant_admin' || req.user?.is_super_admin
  const result = await patchProfile(pool, req.tenantId, req.body, isAdmin)
  if (result.error) return sendError(res, result.error)
  res.json(result.profile)
})

// Create link
router.post('/links', async (req, res) => {
  const result = await createLink(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.link)
})

// Update link (partial)
router.patch('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return
  const result = await patchLink(pool, req.tenantId, linkId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.link)
})

// Delete link
router.delete('/links/:linkId', async (req, res) => {
  const linkId = requireLinkId(req, res); if (linkId === null) return
  const result = await deleteLink(pool, req.tenantId, linkId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Get Mollie API key status (returns masked preview, never the raw key)
router.get('/mollie-key', async (req, res) => {
  res.json(await getMollieKeyStatus(pool, req.tenantId))
})

// Set or replace Mollie API key (tenant admin only)
router.put('/mollie-key', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await setMollieKeyValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.status)
})

// Clear Mollie API key (tenant admin only)
router.delete('/mollie-key', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  res.json(await clearMollieKeyValue(pool, req.tenantId))
})

// Upload / replace band logo (tenant admin only)
router.post('/logo', requirePermission(PERMISSIONS.FINANCE_MANAGE), logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!LOGO_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  res.json(await uploadLogo(pool, req.tenantId, req.file))
})

export default router
