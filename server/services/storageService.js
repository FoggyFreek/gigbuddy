import { storageClient, BUCKET } from '../utils/storage.js'
import pool from '../db/index.js'
import {
  refreshTenantStorageForKey,
  tenantIdFromKey,
  reserveStorageUsage,
  releaseStorageUsage,
} from './statisticsService.js'
import { resolveTenantEntitlements } from './entitlementService.js'
import { LIMITS } from '../auth/entitlements.js'
import { enqueueCleanup } from '../repositories/storageCleanupRepository.js'
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

export const bandMemoryImageKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/memory/${uuid}${ext}`

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

function putObjectRaw(key, buffer, size, contentType) {
  return storageClient.putObject(BUCKET, key, buffer, size, {
    'Content-Type': contentType,
  })
}

// Thrown when an upload would exceed the tenant's storage entitlement. The
// global error handler turns `.status` into the response code (413).
export class StorageQuotaError extends Error {
  constructor(limitMb) {
    super('Storage limit exceeded')
    this.name = 'StorageQuotaError'
    this.status = 413
    this.code = 'storage_limit_exceeded'
    this.limitMb = limitMb
  }
}

const MB = 1024 * 1024

// A failed put may or may not have left a partial object behind. removeObject
// is idempotent, so a successful remove CONFIRMS the object is gone and the
// reservation can be released. If the remove itself fails, keep the
// reservation (usage stays conservative) and queue the key — the
// reconciliation drain deletes it and releases the reservation then.
async function rollbackFailedUpload(tenantId, key, size) {
  try {
    await storageClient.removeObject(BUCKET, key)
    await releaseStorageUsage(tenantId, size)
  } catch (err) {
    logger.warn('storage.upload_rollback_queued', { err, tenantId })
    await enqueueCleanup(pool, tenantId, key, true).catch((queueErr) =>
      logger.error('storage.cleanup_enqueue_failed', { err: queueErr, tenantId }),
    )
  }
}

// THE quota entry point — every tenant object upload must go through here.
// Reserve-then-put: the quota check and usage increment commit atomically
// under the per-tenant advisory lock BEFORE the S3 put, so parallel uploads
// near the limit serialize and cannot jointly exceed it. Throws
// StorageQuotaError (413) when the plan's storage limit would be exceeded;
// tenants without an owner or with an unlimited plan are never blocked.
export async function uploadObjectWithQuota(key, buffer, size, contentType) {
  const tenantId = tenantIdFromKey(key)
  if (!tenantId) {
    // Legacy unprefixed keys are read-only; nothing should upload them.
    return putObjectRaw(key, buffer, size, contentType)
  }

  // The limit resolves INSIDE the reservation's advisory-lock window (see
  // reserveStorageUsage) so a downgrade committing a lower limits snapshot
  // can't be outrun by an in-flight upload.
  let limitMb = null
  const resolveLimitBytes = async (client) => {
    const resolved = await resolveTenantEntitlements(client, tenantId)
    limitMb = resolved?.entitlements.limits[LIMITS.STORAGE_MB] ?? null
    return limitMb === null ? null : limitMb * MB
  }

  if (!(await reserveStorageUsage(tenantId, size, resolveLimitBytes))) {
    throw new StorageQuotaError(limitMb)
  }

  try {
    const result = await putObjectRaw(key, buffer, size, contentType)
    // Fire-and-forget reconcile: the reservation already counted the object;
    // the S3 listing remains the periodic source of truth for drift.
    void refreshTenantStorageForKey(key)
    return result
  } catch (err) {
    await rollbackFailedUpload(tenantId, key, size)
    throw err
  }
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
