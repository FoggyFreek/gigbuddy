import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import {
  requireTenantCapability,
  requireTenantCapabilityForBodyFields,
} from '../middleware/tenant.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireEntitlement, hasEntitledFeature } from '../middleware/entitlements.js'
import { FEATURES } from '../auth/entitlements.js'
import { TENANT_CAPABILITIES } from '../../shared/tenantCapabilities.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  getProfile,
  patchProfile,
  setJoinPolicy,
  createLink,
  patchLink,
  deleteLink,
  getMollieKeyStatus,
  setMollieKeyValue,
  clearMollieKeyValue,
  getResendKeyStatus,
  setResendKeyValue,
  clearResendKeyValue,
  getBandsintownKeyStatus,
  setBandsintownKeyValue,
  clearBandsintownKeyValue,
  getBandsintownArtistIdStatus,
  setBandsintownArtistIdValue,
  clearBandsintownArtistIdValue,
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
  uploadMemoryImage,
  deleteMemoryImage,
} from '../services/profileService.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const CUSTOMIZATION_IMAGE_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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

// Credential endpoints need the tenant.manage permission. Status reads (GET)
// and erasure (DELETE) deliberately do NOT require the integrations
// entitlement — after a downgrade an admin must still be able to see and
// remove stored secrets (GDPR erasure; a lost feature must never trap
// credentials). Only setting/changing a credential (PUT) needs the feature.
const manageIntegration = requirePermission(PERMISSIONS.TENANT_MANAGE)
const writeProfile = requirePermission(PERMISSIONS.PLANNING_WRITE)
const setIntegration = [manageIntegration, requireEntitlement(FEATURES.INTEGRATIONS)]
const bandDiscovery = requireTenantCapability(TENANT_CAPABILITIES.BAND_DISCOVERY)
const bandPromotion = requireTenantCapability(TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS)
const setBandPromotion = [bandPromotion, ...setIntegration]
const BAND_PROMOTION_PROFILE_FIELDS = [
  'bandsintown_artist_name',
  'bandsintown_artist_id',
]
const customization = requireEntitlement(FEATURES.CUSTOMIZATION)
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store')
  next()
}

// Get tenant profile with its links.
router.get('/', async (req, res) => {
  const result = await getProfile(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.profile)
})

// Discoverability in the band directory. Gated on tenant.manage (not the
// planning.write that governs the rest of this router) and on kind: only a
// band can be found and asked to join.
router.patch('/join-policy',
  requirePermission(PERMISSIONS.TENANT_MANAGE),
  bandDiscovery,
  async (req, res) => {
    const result = await setJoinPolicy(pool, req.tenantId, req.body)
    if (result.error) return sendError(res, result.error)
    auditLog(req, result.audit.action, result.audit.details)
    res.json(result.profile)
  })

// Update tenant profile (partial)
router.patch(
  '/',
  writeProfile,
  requireTenantCapabilityForBodyFields(
    TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS,
    BAND_PROMOTION_PROFILE_FIELDS,
  ),
  async (req, res) => {
    // Customization is plan-specific; profile applicability is field-specific.
    const customizationBodyFields = ['accent_color', 'memory_caption', 'memory_gig_id']
    if (customizationBodyFields.some((f) => f in (req.body ?? {})) && !(await hasEntitledFeature(req, FEATURES.CUSTOMIZATION))) {
      return res.status(403).json({
        error: 'This feature is not included in the current subscription plan',
        code: 'entitlement_required',
        feature: FEATURES.CUSTOMIZATION,
      })
    }
    const isAdmin = req.membership?.role === 'tenant_admin' || req.user?.is_super_admin
    const result = await patchProfile(pool, req.tenantId, req.body, isAdmin)
    if (result.error) return sendError(res, result.error)
    res.json(result.profile)
  },
)

// Create link
router.post('/links', writeProfile, async (req, res) => {
  const result = await createLink(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.link)
})

// Update link (partial)
router.patch('/links/:linkId', writeProfile, async (req, res) => {
  const linkId = requireParam(req, res, 'linkId'); if (linkId === null) return
  const result = await patchLink(pool, req.tenantId, linkId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.link)
})

// Delete link
router.delete('/links/:linkId', writeProfile, async (req, res) => {
  const linkId = requireParam(req, res, 'linkId'); if (linkId === null) return
  const result = await deleteLink(pool, req.tenantId, linkId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Get Mollie API key status without returning any credential-derived preview.
router.get('/mollie-key', manageIntegration, noStore, async (req, res) => {
  res.json(await getMollieKeyStatus(pool, req.tenantId))
})

// Set or replace Mollie API key (tenant admin only)
router.put('/mollie-key', setIntegration, noStore, async (req, res) => {
  const result = await setMollieKeyValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.mollie_key.set')
  res.json(result.status)
})

// Clear Mollie API key (tenant admin only)
router.delete('/mollie-key', manageIntegration, noStore, async (req, res) => {
  const status = await clearMollieKeyValue(pool, req.tenantId)
  auditLog(req, 'integration.mollie_key.clear')
  res.json(status)
})

router.get('/resend-key', manageIntegration, noStore, async (req, res) => {
  res.json(await getResendKeyStatus(pool, req.tenantId))
})

router.put('/resend-key', setIntegration, noStore, async (req, res) => {
  const result = await setResendKeyValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.resend_key.set')
  res.json(result.status)
})

router.delete('/resend-key', manageIntegration, noStore, async (req, res) => {
  const status = await clearResendKeyValue(pool, req.tenantId)
  auditLog(req, 'integration.resend_key.clear')
  res.json(status)
})

// Get Bandsintown API key status without returning any credential-derived preview.
router.get('/bandsintown-key', manageIntegration, bandPromotion, noStore, async (req, res) => {
  res.json(await getBandsintownKeyStatus(pool, req.tenantId))
})

// Set or replace Bandsintown API key (tenant admin only)
router.put('/bandsintown-key', setBandPromotion, noStore, async (req, res) => {
  const result = await setBandsintownKeyValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.bandsintown_key.set')
  res.json(result.status)
})

// Clear Bandsintown API key (tenant admin only)
router.delete('/bandsintown-key', manageIntegration, bandPromotion, noStore, async (req, res) => {
  const status = await clearBandsintownKeyValue(pool, req.tenantId)
  auditLog(req, 'integration.bandsintown_key.clear')
  res.json(status)
})

// Get the Bandsintown artist ID (non-secret, returned in full)
router.get('/bandsintown-artist-id', manageIntegration, bandPromotion, noStore, async (req, res) => {
  res.json(await getBandsintownArtistIdStatus(pool, req.tenantId))
})

// Set or replace the Bandsintown artist ID (tenant admin only)
router.put('/bandsintown-artist-id', setBandPromotion, noStore, async (req, res) => {
  const result = await setBandsintownArtistIdValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.bandsintown_artist_id.set')
  res.json(result.status)
})

// Clear the Bandsintown artist ID (tenant admin only)
router.delete('/bandsintown-artist-id', manageIntegration, bandPromotion, noStore, async (req, res) => {
  const status = await clearBandsintownArtistIdValue(pool, req.tenantId)
  auditLog(req, 'integration.bandsintown_artist_id.clear')
  res.json(status)
})

// Get Shopify app Client ID (non-secret, returned in full)
router.get('/shopify-client-id', manageIntegration, bandPromotion, noStore, async (req, res) => {
  res.json(await getShopifyClientIdStatus(pool, req.tenantId))
})

// Set or replace Shopify app Client ID (tenant admin only)
router.put('/shopify-client-id', setBandPromotion, noStore, async (req, res) => {
  const result = await setShopifyClientIdValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.shopify_client_id.set')
  res.json(result.status)
})

// Clear Shopify app Client ID (tenant admin only)
router.delete('/shopify-client-id', manageIntegration, bandPromotion, noStore, async (req, res) => {
  const status = await clearShopifyClientIdValue(pool, req.tenantId)
  auditLog(req, 'integration.shopify_client_id.clear')
  res.json(status)
})

// Get Shopify app secret status without returning any credential-derived preview.
router.get('/shopify-secret', manageIntegration, bandPromotion, noStore, async (req, res) => {
  res.json(await getShopifySecretStatus(pool, req.tenantId))
})

// Set or replace Shopify app secret (tenant admin only)
router.put('/shopify-secret', setBandPromotion, noStore, async (req, res) => {
  const result = await setShopifySecretValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.shopify_secret.set')
  res.json(result.status)
})

// Clear Shopify app secret (tenant admin only)
router.delete('/shopify-secret', manageIntegration, bandPromotion, noStore, async (req, res) => {
  const status = await clearShopifySecretValue(pool, req.tenantId)
  auditLog(req, 'integration.shopify_secret.clear')
  res.json(status)
})

// Get Shopify store domain (non-secret, returned in full)
router.get('/shopify-domain', manageIntegration, bandPromotion, noStore, async (req, res) => {
  res.json(await getShopifyDomainStatus(pool, req.tenantId))
})

// Set or replace Shopify store domain (tenant admin only)
router.put('/shopify-domain', setBandPromotion, noStore, async (req, res) => {
  const result = await setShopifyDomainValue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'integration.shopify_domain.set')
  res.json(result.status)
})

// Clear Shopify store domain (tenant admin only)
router.delete('/shopify-domain', manageIntegration, bandPromotion, noStore, async (req, res) => {
  const status = await clearShopifyDomainValue(pool, req.tenantId)
  auditLog(req, 'integration.shopify_domain.clear')
  res.json(status)
})

// Upload / replace band logo (tenant admin only). The band logos (light +
// dark) are deliberately NOT part of the customization entitlement — every
// plan, including the fallback, may set them. Banner/avatar stay gated.
router.post('/logo', requirePermission(PERMISSIONS.TENANT_MANAGE), logoUpload.single('logo'), async (req, res) =>
  handleImageUpload(req, res, uploadLogo, LOGO_ALLOWED_TYPES))

// Upload / replace profile banner (tenant admin only)
router.post('/banner', requirePermission(PERMISSIONS.TENANT_MANAGE), customization, imageUpload.single('banner'), async (req, res) =>
  handleImageUpload(req, res, uploadBanner, CUSTOMIZATION_IMAGE_ALLOWED_TYPES))

// Upload / replace profile avatar (tenant admin only)
router.post('/avatar', requirePermission(PERMISSIONS.TENANT_MANAGE), customization, imageUpload.single('avatar'), async (req, res) =>
  handleImageUpload(req, res, uploadAvatar, CUSTOMIZATION_IMAGE_ALLOWED_TYPES))

// Upload / replace dark-theme logo variant (tenant admin only, ungated — see /logo)
router.post('/logo-dark', requirePermission(PERMISSIONS.TENANT_MANAGE), imageUpload.single('logo_dark'), async (req, res) =>
  handleImageUpload(req, res, uploadLogoDark, LOGO_ALLOWED_TYPES))

// Upload / replace the dashboard memory-tile image. Unlike banner/avatar this is
// NOT tenant-admin-only — any member with planning write may set the band's
// memory photo (the tile is for the whole band). Still gated by customization.
router.post('/memory-image', writeProfile, customization, imageUpload.single('memory'), async (req, res) =>
  handleImageUpload(req, res, uploadMemoryImage, CUSTOMIZATION_IMAGE_ALLOWED_TYPES))

// Remove the dashboard memory-tile photo. Deliberately NOT gated by the
// customization entitlement (only planning write): removal is data erasure, and
// a lost feature must never trap a stored image — mirrors the credential DELETEs.
router.delete('/memory-image', writeProfile, async (req, res) => {
  res.json(await deleteMemoryImage(pool, req.tenantId))
})

export default router
