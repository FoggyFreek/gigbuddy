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
  getShopifyClientIdStatus,
  setShopifyClientIdValue,
  clearShopifyClientIdValue,
  getShopifySecretStatus,
  setShopifySecretValue,
  clearShopifySecretValue,
  getShopifyDomainStatus,
  setShopifyDomainValue,
  clearShopifyDomainValue,
  uploadLogo,
  uploadBanner,
  uploadAvatar,
  uploadLogoDark,
} from '../services/profileService.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const JPEG_PNG = new Set(['image/jpeg', 'image/png'])

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

async function handleImageUpload(req, res, uploadFn, allowedTypes) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!allowedTypes.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  res.json(await uploadFn(pool, req.tenantId, req.file))
}

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

// Get Shopify app Client ID (non-secret, returned in full)
router.get('/shopify-client-id', async (req, res) => {
  res.json(await getShopifyClientIdStatus(pool, req.tenantId))
})

// Set or replace Shopify app Client ID (tenant admin only)
router.put('/shopify-client-id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const result = await setShopifyClientIdValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.status)
})

// Clear Shopify app Client ID (tenant admin only)
router.delete('/shopify-client-id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  res.json(await clearShopifyClientIdValue(pool, req.tenantId))
})

// Get Shopify app secret status (returns masked preview, never the raw secret)
router.get('/shopify-secret', async (req, res) => {
  res.json(await getShopifySecretStatus(pool, req.tenantId))
})

// Set or replace Shopify app secret (tenant admin only)
router.put('/shopify-secret', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const result = await setShopifySecretValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.status)
})

// Clear Shopify app secret (tenant admin only)
router.delete('/shopify-secret', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  res.json(await clearShopifySecretValue(pool, req.tenantId))
})

// Get Shopify store domain (non-secret, returned in full)
router.get('/shopify-domain', async (req, res) => {
  res.json(await getShopifyDomainStatus(pool, req.tenantId))
})

// Set or replace Shopify store domain (tenant admin only)
router.put('/shopify-domain', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const result = await setShopifyDomainValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.status)
})

// Clear Shopify store domain (tenant admin only)
router.delete('/shopify-domain', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  res.json(await clearShopifyDomainValue(pool, req.tenantId))
})

// Upload / replace band logo (tenant admin only)
router.post('/logo', requirePermission(PERMISSIONS.TENANT_MANAGE), logoUpload.single('logo'), async (req, res) =>
  handleImageUpload(req, res, uploadLogo, LOGO_ALLOWED_TYPES))

// Upload / replace profile banner (tenant admin only)
router.post('/banner', requirePermission(PERMISSIONS.TENANT_MANAGE), imageUpload.single('banner'), async (req, res) =>
  handleImageUpload(req, res, uploadBanner, JPEG_PNG))

// Upload / replace profile avatar (tenant admin only)
router.post('/avatar', requirePermission(PERMISSIONS.TENANT_MANAGE), imageUpload.single('avatar'), async (req, res) =>
  handleImageUpload(req, res, uploadAvatar, JPEG_PNG))

// Upload / replace dark-theme logo variant (tenant admin only)
router.post('/logo-dark', requirePermission(PERMISSIONS.TENANT_MANAGE), imageUpload.single('logo_dark'), async (req, res) =>
  handleImageUpload(req, res, uploadLogoDark, LOGO_ALLOWED_TYPES))

export default router
