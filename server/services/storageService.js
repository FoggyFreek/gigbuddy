import { storageClient, BUCKET } from '../utils/storage.js'
import { refreshTenantStorageForKey, tenantIdFromKey } from './statisticsService.js'
import { logger } from '../utils/logger.js'

// ---------- key builders ----------

export const gigBannerKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/gig-banners/${uuid}${ext}`

export const gigAttachmentKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/gig_attachments/${uuid}${ext}`

export const bandLogoKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/logo/${uuid}${ext}`

export const bandProfileBannerKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/profile-banner/${uuid}${ext}`

export const bandAvatarKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/avatar/${uuid}${ext}`

export const bandLogoDarkKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/logo-dark/${uuid}${ext}`

export const sharePhotoKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/share/${uuid}${ext}`

export const invoicePdfKey = (tenantId, uuid) =>
  `tenants/${tenantId}/invoices/${uuid}.pdf`

export const invoiceLogoKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/invoices/logo-${uuid}${ext}`

export const purchaseAttachmentKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/purchase_attachments/${uuid}${ext}`

export const songDocumentKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/song_documents/${uuid}${ext}`

export const songRecordingKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/song_recordings/${uuid}${ext}`

// ---------- reads ----------

export const statObject = (key) => storageClient.statObject(BUCKET, key)

export const getObject = (key) => storageClient.getObject(BUCKET, key)

// ---------- mutations ----------

export async function uploadObject(key, buffer, size, contentType) {
  const result = await storageClient.putObject(BUCKET, key, buffer, size, {
    'Content-Type': contentType,
  })
  // Fire-and-forget: keep tenant_statistics fresh without blocking the response
  // on an S3 listing, and never let a stats failure fail the upload.
  void refreshTenantStorageForKey(key)
  return result
}

export function removeObject(key) {
  const promise = storageClient.removeObject(BUCKET, key)
  // Refresh only after a successful delete. Return the original promise so the
  // caller's rejection timing is unchanged (safeRemove relies on it); the
  // no-op reject handler here keeps this branch from surfacing as an unhandled
  // rejection — the caller still sees the original error.
  promise.then(() => refreshTenantStorageForKey(key), () => {})
  return promise
}

// safeRemove delegates to removeObject (which already triggers the refresh), so
// no extra refresh here — adding one would run a second full S3 listing.
// `_warnMsg` is kept for the many existing call sites' signatures but is no
// longer used for free-text logging — see logger.js's CONTEXT_KEYS doc comment
// for why structured logs don't accept arbitrary message strings.
export function safeRemove(key, _warnMsg) {
  if (!key) return
  removeObject(key).catch((err) => logger.warn('storage.remove_failed', { err, tenantId: tenantIdFromKey(key) }))
}

function listObjectKeys(prefix) {
  return new Promise((resolve, reject) => {
    const keys = []
    const stream = storageClient.listObjectsV2(BUCKET, prefix, true)
    stream.on('data', (obj) => {
      if (obj.name) keys.push(obj.name)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(keys))
  })
}

// Permanently removes every object owned by a tenant. Modern assets are found
// by prefix, including unreferenced leftovers; exact legacy keys are supplied
// by the database because old unprefixed objects cannot encode ownership.
export async function deleteTenantObjects(tenantId, legacyKeys = []) {
  const prefix = `tenants/${tenantId}/`
  const prefixedKeys = await listObjectKeys(prefix)
  const keys = [...new Set([...prefixedKeys, ...legacyKeys.filter(Boolean)])]

  for (let i = 0; i < keys.length; i += 1000) {
    const failures = await storageClient.removeObjects(BUCKET, keys.slice(i, i + 1000))
    if (failures.length) throw new Error('Tenant object deletion failed')
  }

  if ((await listObjectKeys(prefix)).length) {
    throw new Error('Tenant storage prefix is not empty after deletion')
  }
}
