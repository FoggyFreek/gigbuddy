// Tenant-profile domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload. Invalid-URL
// validation throws (err.status 400) to match the legacy global-handler shape.
import { randomUUID } from 'node:crypto'
import { uploadObject, removeObject, safeRemove, bandLogoKey } from './storageService.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import {
  FINANCIAL_FIELDS_SET,
  isValidMollieKey,
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
  getLogoPath,
  setLogoPath,
} from '../repositories/profileRepository.js'

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

function notFound(error) {
  return { error: { status: 404, body: { error } } }
}

function maskMollieKey(key) {
  if (!key) return null
  const prefix = key.slice(0, 5)
  const last4 = key.slice(-4)
  const dots = '•'.repeat(Math.max(0, key.length - 9))
  return `${prefix}${dots}${last4}`
}

// mollie_api_key is never returned in profile payloads — use the mollie-key
// endpoints for masked status.
function stripMollieKey(tenant) {
  const copy = { ...tenant }
  delete copy.mollie_api_key
  return copy
}

// ---------- profile ----------

export async function getProfile(db, tenantId) {
  const tenant = await fetchTenant(db, tenantId)
  if (!tenant) return notFound('Profile not found')
  const links = await listProfileLinks(db, tenantId)
  return { profile: { ...stripMollieKey(tenant), links } }
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
  return { profile: stripMollieKey(updated) }
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
  return { isSet: !!key, preview: maskMollieKey(key) }
}

export async function setMollieKeyValue(db, tenantId, body) {
  const { key } = body || {}
  if (!isValidMollieKey(key)) return badRequest('invalid_mollie_key')
  const stored = await setMollieKey(db, tenantId, key)
  return { status: { isSet: !!stored, preview: maskMollieKey(stored) } }
}

export async function clearMollieKeyValue(db, tenantId) {
  await clearMollieKey(db, tenantId)
  return { isSet: false, preview: null }
}

// ---------- logo ----------

// Re-encodes the uploaded image, stores it, points the tenant at the new object,
// and removes the previous one. Rolls the new object back if the DB update fails.
export async function uploadLogo(db, tenantId, file) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = bandLogoKey(tenantId, randomUUID(), ext)

  const oldKey = await getLogoPath(db, tenantId)

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

  let updatedKey
  try {
    updatedKey = await setLogoPath(db, tenantId, objectKey)
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  safeRemove(oldKey, 'Failed to delete old logo object:')
  return { logo_path: updatedKey }
}
