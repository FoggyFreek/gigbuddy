// Tenant-profile domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload. Invalid-URL
// validation throws (err.status 400) to match the legacy global-handler shape.
import { randomUUID } from 'node:crypto'
import {
  uploadObjectWithQuota, removeObject, safeRemove,
  bandLogoKey, bandProfileBannerKey, bandAvatarKey, bandLogoDarkKey, bandMemoryImageKey,
} from './storageService.js'
import { IMAGE_PROCESSING_PRESETS, validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import {
  FINANCIAL_FIELDS_SET,
  MEMORY_FIELDS,
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
  clearMemoryTile,
  gigBelongsToTenant,
} from '../repositories/profileRepository.js'
import { fetchTenant, fetchTenantVatCountry } from '../repositories/tenantRepository.js'
import { DEFAULT_VAT_COUNTRY, normalizeVatCountry } from '../../shared/vatRates.js'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import {
  clearIntegrationCredential,
  getIntegrationCredentialStatus,
  setIntegrationCredential,
} from './integrationCredentialService.js'
import { invalidateToken } from './shopifyTokenService.js'
import { withFeatureWriteGuard, withIntegrationWriteLock } from './featureGuards.js'
import { resolveTenantEntitlements } from './entitlementService.js'
import { FEATURES } from '../auth/entitlements.js'
import { badRequest, notFound } from './serviceErrors.js'

function entitlementRequired(feature) {
  return {
    error: {
      status: 403,
      body: { error: 'This feature is not included in the current subscription plan', code: 'entitlement_required', feature },
    },
  }
}

// Credential SETS run under the per-tenant integration-write session lock and
// re-check the integrations entitlement inside it, so a set can never race the
// integrations purge and leave a fresh secret behind after the feature is
// gone. Clears/erasure stay unguarded (a lost feature must never trap
// credentials) — the mollie clear still takes the lock so it serializes with
// the purge's retain-vs-delete decision.
async function guardedIntegrationWrite(db, tenantId, fn) {
  return withIntegrationWriteLock(db, tenantId, async () => {
    const resolved = await resolveTenantEntitlements(db, tenantId)
    if (resolved !== null && resolved.entitlements.features[FEATURES.INTEGRATIONS] !== true) {
      return entitlementRequired(FEATURES.INTEGRATIONS)
    }
    return fn()
  })
}

async function setIntegrationCredentialGuarded(db, tenantId, type, plaintext) {
  return guardedIntegrationWrite(db, tenantId, async () => ({
    status: await setIntegrationCredential(db, tenantId, type, plaintext),
  }))
}

// ---------- profile ----------

export async function getProfile(db, tenantId) {
  const tenant = await fetchTenant(db, tenantId)
  if (!tenant) return notFound('Profile not found')
  const links = await listProfileLinks(db, tenantId)
  return { profile: { ...tenant, links } }
}

const ADMIN_ONLY_PROFILE_FIELDS = new Set([...FINANCIAL_FIELDS_SET, 'accent_color'])

// Customization-feature fields settable through PATCH /profile. The memory tile
// (unlike accent_color) is NOT admin-only — any member with planning write may
// edit it — but it is still customization data, so its write takes the same
// purge-race guard.
const CUSTOMIZATION_PROFILE_FIELDS = new Set(['accent_color', ...MEMORY_FIELDS])

// `isAdmin` is computed by the route (tenant_admin or super admin); tenant-wide
// financial and appearance settings are gated to admins.
export async function patchProfile(db, tenantId, body, isAdmin) {
  const touchesAdminOnlyField = Object.keys(body || {}).some((key) => ADMIN_ONLY_PROFILE_FIELDS.has(key))
  if (touchesAdminOnlyField && !isAdmin) {
    return { error: { status: 403, body: { error: 'tenant_admin_required' } } }
  }

  // A memory tile can only point at one of THIS tenant's gigs. Verify ownership
  // before the write (the FK alone enforces existence, not tenancy); a missing /
  // cross-tenant gig 404s so existence isn't leaked. Clearing (null) is exempt.
  const memoryGigId = body?.memory_gig_id
  if (memoryGigId !== null && memoryGigId !== undefined && memoryGigId !== '') {
    if (!(await gigBelongsToTenant(db, tenantId, memoryGigId))) return notFound('Gig not found')
  }

  // tax_id is validated against the tenant's VAT country: the value being set in
  // this same PATCH, else the stored one. Only look it up when tax_id is present.
  let vatCountry = DEFAULT_VAT_COUNTRY
  if (body && 'tax_id' in body) {
    vatCountry = normalizeVatCountry(body.vat_country)
      ?? await fetchTenantVatCountry(db, tenantId)
      ?? DEFAULT_VAT_COUNTRY
  }

  const built = buildProfileUpdate(body || {}, { vatCountry })
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  // accent_color and the memory tile are customization data: the guarded write
  // closes the race with a concurrent downgrade purge (route-level gate already
  // covers the common case).
  const touchesCustomization = Object.keys(body || {}).some((key) => CUSTOMIZATION_PROFILE_FIELDS.has(key))
  const updated = touchesCustomization
    ? await withFeatureWriteGuard(db, tenantId, FEATURES.CUSTOMIZATION,
        (client) => updateTenantFields(client, tenantId, built.fields, built.values))
    : await updateTenantFields(db, tenantId, built.fields, built.values)
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
  // Storing a new key also clears mollie_api_key_retained_at (repo layer).
  return setIntegrationCredentialGuarded(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY, key.trim())
}

export async function clearMollieKeyValue(db, tenantId) {
  return withIntegrationWriteLock(db, tenantId, () =>
    clearIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY))
}

// ---------- bandsintown api key ----------

export async function getBandsintownKeyStatus(db, tenantId) {
  return getIntegrationCredentialStatus(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID)
}

export async function setBandsintownKeyValue(db, tenantId, body) {
  const { key } = body || {}
  if (!isValidBandsintownAppId(key)) return badRequest('invalid_bandsintown_key')
  return setIntegrationCredentialGuarded(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID, key.trim())
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
  return guardedIntegrationWrite(db, tenantId, async () => {
    const stored = await setShopifyClientId(db, tenantId, clientId.trim())
    invalidateToken(tenantId)
    return { status: { clientId: stored } }
  })
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
  const result = await setIntegrationCredentialGuarded(db, tenantId, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET, secret.trim())
  invalidateToken(tenantId)
  return result
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
  return guardedIntegrationWrite(db, tenantId, async () => {
    const stored = await setShopifyDomain(db, tenantId, normalizeShopifyDomain(domain))
    invalidateToken(tenantId)
    return { status: { domain: stored } }
  })
}

export async function clearShopifyDomainValue(db, tenantId) {
  await clearShopifyDomain(db, tenantId)
  invalidateToken(tenantId)
  return { domain: null }
}

// ---------- image uploads (logo, banner, avatar, dark logo) ----------

// Re-encodes the uploaded image, stores it under the given column, and removes
// the previous object. Rolls the new object back if the DB update fails.
// `guardFeature` (banner/avatar): the column is purgeable customization data,
// so the persist runs under the feature write guard; the logos pass null —
// they are settable on every plan and never purged, so there is no purge race
// to close.
async function uploadTenantImage(db, tenantId, file, keyBuilder, column, processingPreset, guardFeature = null) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype, processingPreset)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = keyBuilder(tenantId, randomUUID(), ext)

  const oldKey = await getTenantImagePath(db, tenantId, column)

  await uploadObjectWithQuota(objectKey, image.buffer, image.size, image.mimetype)

  let updatedKey
  try {
    // Guarded write: aborts (403) if a downgrade purge turned the feature
    // off between the route gate and this persist; the uploaded object is
    // queued for cleanup instead of being orphaned.
    updatedKey = guardFeature
      ? await withFeatureWriteGuard(db, tenantId, guardFeature,
          (client) => setTenantImagePath(client, tenantId, column, objectKey),
          { orphanKey: objectKey })
      : await setTenantImagePath(db, tenantId, column, objectKey)
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
  uploadTenantImage(db, tenantId, file, bandProfileBannerKey, 'banner_path', IMAGE_PROCESSING_PRESETS.profileBanner, FEATURES.CUSTOMIZATION)

export const uploadAvatar = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandAvatarKey, 'avatar_path', IMAGE_PROCESSING_PRESETS.avatar, FEATURES.CUSTOMIZATION)

export const uploadLogoDark = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandLogoDarkKey, 'logo_dark_path', IMAGE_PROCESSING_PRESETS.logo)

export const uploadMemoryImage = (db, tenantId, file) =>
  uploadTenantImage(db, tenantId, file, bandMemoryImageKey, 'memory_image_path', IMAGE_PROCESSING_PRESETS.memory, FEATURES.CUSTOMIZATION)

// Clears the dashboard memory tile: nulls the photo, caption and gig link, and
// deletes the stored object so its quota is reclaimed. Idempotent: a no-op when
// nothing is set. Clearing needs no purge-race guard (removing data never
// conflicts with a downgrade purge) and no entitlement gate (a lost feature
// must not trap data).
export async function deleteMemoryImage(db, tenantId) {
  const oldKey = await getTenantImagePath(db, tenantId, 'memory_image_path')
  await clearMemoryTile(db, tenantId)
  safeRemove(oldKey, 'Failed to delete memory image:')
  return { memory_image_path: null, memory_caption: null, memory_gig_id: null }
}
