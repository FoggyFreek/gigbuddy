// Tenant-profile domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload. Invalid-URL
// validation throws (err.status 400) to match the legacy global-handler shape.
import { randomUUID } from 'node:crypto'
import {
  uploadObject, removeObject, safeRemove,
  bandLogoKey, bandProfileBannerKey, bandAvatarKey, bandLogoDarkKey,
} from './storageService.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import {
  FINANCIAL_FIELDS_SET,
  isValidMollieKey,
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
  getMollieKey,
  setMollieKey,
  clearMollieKey,
  getShopifyClientId,
  setShopifyClientId,
  clearShopifyClientId,
  getShopifyClientSecret,
  setShopifyClientSecret,
  clearShopifyClientSecret,
  getShopifyDomain,
  setShopifyDomain,
  clearShopifyDomain,
  getTenantImagePath,
  setTenantImagePath,
} from '../repositories/profileRepository.js'

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

function notFound(error) {
  return { error: { status: 404, body: { error } } }
}

function maskKey(key) {
  if (!key) return null
  const underscore = key.indexOf('_')
  const prefix = underscore >= 0 ? key.slice(0, underscore + 1) : key.slice(0, 5)
  const last4 = key.slice(-4)
  const dots = '•'.repeat(Math.max(0, key.length - prefix.length - 4))
  return `${prefix}${dots}${last4}`
}

// mollie_api_key and shopify_client_secret are never returned in profile
// payloads — use the dedicated endpoints for masked status.
function stripSecretKeys(tenant) {
  const copy = { ...tenant }
  delete copy.mollie_api_key
  delete copy.shopify_client_secret
  return copy
}

// ---------- profile ----------

export async function getProfile(db, tenantId) {
  const tenant = await fetchTenant(db, tenantId)
  if (!tenant) return notFound('Profile not found')
  const links = await listProfileLinks(db, tenantId)
  return { profile: { ...stripSecretKeys(tenant), links } }
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
  return { profile: stripSecretKeys(updated) }
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
  const key = await getMollieKey(db, tenantId)
  return { isSet: !!key, preview: maskKey(key) }
}

export async function setMollieKeyValue(db, tenantId, body) {
  const { key } = body || {}
  if (!isValidMollieKey(key)) return badRequest('invalid_mollie_key')
  const stored = await setMollieKey(db, tenantId, key)
  return { status: { isSet: !!stored, preview: maskKey(stored) } }
}

export async function clearMollieKeyValue(db, tenantId) {
  await clearMollieKey(db, tenantId)
  return { isSet: false, preview: null }
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
  return { status: { clientId: stored } }
}

export async function clearShopifyClientIdValue(db, tenantId) {
  await clearShopifyClientId(db, tenantId)
  return { clientId: null }
}

// Client secret is masked, like the Mollie key.
export async function getShopifySecretStatus(db, tenantId) {
  const secret = await getShopifyClientSecret(db, tenantId)
  return { isSet: !!secret, preview: maskKey(secret) }
}

export async function setShopifySecretValue(db, tenantId, body) {
  const { secret } = body || {}
  if (!isValidShopifyClientSecret(secret)) return badRequest('invalid_shopify_client_secret')
  const stored = await setShopifyClientSecret(db, tenantId, secret.trim())
  return { status: { isSet: !!stored, preview: maskKey(stored) } }
}

export async function clearShopifySecretValue(db, tenantId) {
  await clearShopifyClientSecret(db, tenantId)
  return { isSet: false, preview: null }
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
  return { status: { domain: stored } }
}

export async function clearShopifyDomainValue(db, tenantId) {
  await clearShopifyDomain(db, tenantId)
  return { domain: null }
}

// ---------- image uploads (logo, banner, avatar, dark logo) ----------

// Re-encodes the uploaded image, stores it under the given column, and removes
// the previous object. Rolls the new object back if the DB update fails.
async function uploadTenantImage(db, tenantId, file, keyBuilder, column) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = keyBuilder(tenantId, randomUUID(), ext)

  const oldKey = await getTenantImagePath(db, tenantId, column)

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

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
  uploadTenantImage(db, tenantId, file, bandLogoKey, 'logo_path')

export const uploadBanner = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandProfileBannerKey, 'banner_path')

export const uploadAvatar = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandAvatarKey, 'avatar_path')

export const uploadLogoDark = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandLogoDarkKey, 'logo_dark_path')
