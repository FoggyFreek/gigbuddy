// Tenant-profile domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload. Invalid-URL
// validation throws (err.status 400) to match the legacy global-handler shape.
import { randomUUID } from 'node:crypto'
import {
  uploadObjectWithQuota, removeObject, safeRemove,
  bandLogoKey, bandProfileBannerKey, bandAvatarKey, bandLogoDarkKey,
} from './storageService.js'
import { IMAGE_PROCESSING_PRESETS, validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import {
  FINANCIAL_FIELDS_SET,
  isValidMollieKey,
  isValidBandsintownAppId,
  isValidShopifyClientId,
  isValidShopifyClientSecret,
  isValidShopifyDomain,
  normalizeShopifyDomain,
  normalizeRequiredProfileUrl,
  buildProfileUpdate,
  buildLinkUpdate,
} from '../validators/profileValidators.js'
import {
  fetchTenant,
  listProfileLinks,
  updateTenantFields,
  nextLinkSortOrder,
  insertProfileLink,
  updateProfileLink,
  deleteProfileLink,
  getShopifyClientId,
  setShopifyClientId,
  clearShopifyClientId,
  getShopifyDomain,
  setShopifyDomain,
  clearShopifyDomain,
  getTenantImagePath,
  setTenantImagePath,
} from '../repositories/profileRepository.js'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import {
  clearIntegrationCredential,
  getIntegrationCredentialStatus,
  setIntegrationCredential,
} from './integrationCredentialService.js'
import { invalidateToken } from './shopifyTokenService.js'

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

function notFound(error) {
  return { error: { status: 404, body: { error } } }
}

// ---------- profile ----------

export async function getProfile(db, tenantId) {
  const tenant = await fetchTenant(db, tenantId)
  if (!tenant) return notFound('Profile not found')
  const links = await listProfileLinks(db, tenantId)
  return { profile: { ...tenant, links } }
}

// `isAdmin` is computed by the route (tenant_admin or super admin); financial
// fields are gated to admins.
export async function patchProfile(db, tenantId, body, isAdmin) {
  const touchesFinancial = Object.keys(body || {}).some((k) => FINANCIAL_FIELDS_SET.has(k))
  if (touchesFinancial && !isAdmin) {
    return { error: { status: 403, body: { error: 'tenant_admin_required' } } }
  }

  const built = buildProfileUpdate(body || {})
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const updated = await updateTenantFields(db, tenantId, built.fields, built.values)
  if (!updated) return notFound('Profile not found')
  return { profile: updated }
}

// ---------- links ----------

export async function createLink(db, tenantId, body) {
  const { label, url } = body
  if (!label || !url) return badRequest('label and url are required')
  const normalizedUrl = normalizeRequiredProfileUrl(url)

  const sortOrder = await nextLinkSortOrder(db, tenantId)
  const link = await insertProfileLink(db, tenantId, label, normalizedUrl, sortOrder)
  return { link }
}

export async function patchLink(db, tenantId, linkId, body) {
  const built = buildLinkUpdate(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const link = await updateProfileLink(db, tenantId, linkId, built.fields, built.values)
  if (!link) return notFound('Not found')
  return { link }
}

export async function deleteLink(db, tenantId, linkId) {
  const deleted = await deleteProfileLink(db, linkId, tenantId)
  return deleted ? {} : notFound('Not found')
}

// ---------- mollie key ----------

export async function getMollieKeyStatus(db, tenantId) {
  return getIntegrationCredentialStatus(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
}

export async function setMollieKeyValue(db, tenantId, body) {
  const { key } = body || {}
  if (!isValidMollieKey(key)) return badRequest('invalid_mollie_key')
  const status = await setIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY, key.trim())
  return { status }
}

export async function clearMollieKeyValue(db, tenantId) {
  return clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
}

// ---------- bandsintown api key ----------

export async function getBandsintownKeyStatus(db, tenantId) {
  return getIntegrationCredentialStatus(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID)
}

export async function setBandsintownKeyValue(db, tenantId, body) {
  const { key } = body || {}
  if (!isValidBandsintownAppId(key)) return badRequest('invalid_bandsintown_key')
  const status = await setIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID, key.trim())
  return { status }
}

export async function clearBandsintownKeyValue(db, tenantId) {
  return clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID)
}

// ---------- shopify app credentials ----------

// Client ID is not a secret; returned in full so the user can verify it.
export async function getShopifyClientIdStatus(db, tenantId) {
  const clientId = await getShopifyClientId(db, tenantId)
  return { clientId: clientId || null }
}

export async function setShopifyClientIdValue(db, tenantId, body) {
  const { clientId } = body || {}
  if (!isValidShopifyClientId(clientId)) return badRequest('invalid_shopify_client_id')
  const stored = await setShopifyClientId(db, tenantId, clientId.trim())
  invalidateToken(tenantId)
  return { status: { clientId: stored } }
}

export async function clearShopifyClientIdValue(db, tenantId) {
  await clearShopifyClientId(db, tenantId)
  invalidateToken(tenantId)
  return { clientId: null }
}

// Secret status exposes only presence and the last configuration-change time.
export async function getShopifySecretStatus(db, tenantId) {
  return getIntegrationCredentialStatus(db, tenantId, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET)
}

export async function setShopifySecretValue(db, tenantId, body) {
  const { secret } = body || {}
  if (!isValidShopifyClientSecret(secret)) return badRequest('invalid_shopify_client_secret')
  const status = await setIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET, secret.trim())
  invalidateToken(tenantId)
  return { status }
}

export async function clearShopifySecretValue(db, tenantId) {
  const status = await clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET)
  invalidateToken(tenantId)
  return status
}

// ---------- shopify store domain (non-secret, returned in full) ----------

export async function getShopifyDomainStatus(db, tenantId) {
  const domain = await getShopifyDomain(db, tenantId)
  return { domain: domain || null }
}

export async function setShopifyDomainValue(db, tenantId, body) {
  const { domain } = body || {}
  if (!isValidShopifyDomain(domain)) return badRequest('invalid_shopify_domain')
  const stored = await setShopifyDomain(db, tenantId, normalizeShopifyDomain(domain))
  invalidateToken(tenantId)
  return { status: { domain: stored } }
}

export async function clearShopifyDomainValue(db, tenantId) {
  await clearShopifyDomain(db, tenantId)
  invalidateToken(tenantId)
  return { domain: null }
}

// ---------- image uploads (logo, banner, avatar, dark logo) ----------

// Re-encodes the uploaded image, stores it under the given column, and removes
// the previous object. Rolls the new object back if the DB update fails.
async function uploadTenantImage(db, tenantId, file, keyBuilder, column, processingPreset) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype, processingPreset)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = keyBuilder(tenantId, randomUUID(), ext)

  const oldKey = await getTenantImagePath(db, tenantId, column)

  await uploadObjectWithQuota(objectKey, image.buffer, image.size, image.mimetype)

  let updatedKey
  try {
    updatedKey = await setTenantImagePath(db, tenantId, column, objectKey)
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  safeRemove(oldKey, `Failed to delete old ${column}:`)
  return { [column]: updatedKey }
}

export const uploadLogo = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandLogoKey, 'logo_path', IMAGE_PROCESSING_PRESETS.logo)

export const uploadBanner = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandProfileBannerKey, 'banner_path', IMAGE_PROCESSING_PRESETS.banner)

export const uploadAvatar = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandAvatarKey, 'avatar_path', IMAGE_PROCESSING_PRESETS.avatar)

export const uploadLogoDark = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandLogoDarkKey, 'logo_dark_path', IMAGE_PROCESSING_PRESETS.logo)
