import * as storage from '../utils/storage.js'
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

const hasStorageExport = (name) => Object.prototype.hasOwnProperty.call(storage, name)
const publicStorageClient = hasStorageExport('publicStorageClient') ? storage.publicStorageClient : storage.storageClient
const privateStorageClient = hasStorageExport('privateStorageClient') ? storage.privateStorageClient : storage.storageClient
const PUBLIC_BUCKET = hasStorageExport('PUBLIC_BUCKET') ? storage.PUBLIC_BUCKET : storage.BUCKET
const PRIVATE_BUCKET = hasStorageExport('PRIVATE_BUCKET') ? storage.PRIVATE_BUCKET : storage.BUCKET
const PUBLIC_STORE = hasStorageExport('PUBLIC_STORE') ? storage.PUBLIC_STORE : {
  id: 'public', client: publicStorageClient, bucket: PUBLIC_BUCKET,
}
const PRIVATE_STORE = hasStorageExport('PRIVATE_STORE') ? storage.PRIVATE_STORE : {
  id: 'private', client: privateStorageClient, bucket: PRIVATE_BUCKET,
}

const TENANT_KEY_RE = /^tenants\/([1-9]\d*)\/([^/]+)\/(.+)$/

export function parseTenantObjectKey(key) {
  const match = TENANT_KEY_RE.exec(key || '')
  if (!match) return null
  return { tenantId: Number(match[1]), category: match[2] }
}

export function storeForKey(key) {
  const parsed = parseTenantObjectKey(key)
  return parsed ? PRIVATE_STORE : PUBLIC_STORE
}

function sameStore(left, right) {
  return left.client === right.client && left.bucket === right.bucket
}

export function isObjectMissing(err) {
  return err?.code === 'NoSuchKey'
    || err?.code === 'NotFound'
    || err?.statusCode === 404
    || err?.status === 404
}

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

export const songCoverKey = (tenantId, uuid, ext) =>
  `tenants/${tenantId}/song_covers/${uuid}${ext}`

// ---------- reads ----------

async function readWithFallback(method, key, ...args) {
  const routed = storeForKey(key)
  try {
    return await routed.client[method](routed.bucket, key, ...args)
  } catch (err) {
    if (routed.id !== 'private' || !isObjectMissing(err) || sameStore(routed, PUBLIC_STORE)) {
      throw err
    }
    return PUBLIC_STORE.client[method](PUBLIC_STORE.bucket, key, ...args)
  }
}

export const statObject = (key) => readWithFallback('statObject', key)

export const getObject = (key) => readWithFallback('getObject', key)

// Byte-range read, backing HTTP 206 responses. The client turns this into an
// upstream Range header, so only the requested bytes leave the object store —
// a seek costs its tail, not a whole re-download.
export const getPartialObject = (key, offset, length) =>
  readWithFallback('getPartialObject', key, offset, length)

// ---------- mutations ----------

function putObjectRaw(key, buffer, size, contentType) {
  const { client, bucket } = storeForKey(key)
  return client.putObject(bucket, key, buffer, size, {
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
  const store = storeForKey(key)
  try {
    await store.client.removeObject(store.bucket, key)
    await releaseStorageUsage(tenantId, size)
  } catch (err) {
    logger.warn('storage.upload_rollback_queued', { err, tenantId })
    await enqueueCleanup(pool, tenantId, key, true, store.id).catch((queueErr) =>
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
  const routed = storeForKey(key)
  const primary = routed.client.removeObject(routed.bucket, key)
  let promise = primary
  if (routed.id === 'private' && !sameStore(routed, PUBLIC_STORE)) {
    const fallback = PUBLIC_STORE.client.removeObject(PUBLIC_STORE.bucket, key)
    promise = Promise.allSettled([primary, fallback]).then(async (results) => {
      const stores = [routed, PUBLIC_STORE]
      const failures = results
        .map((result, index) => ({ result, store: stores[index] }))
        .filter(({ result }) => result.status === 'rejected')
      for (const { store } of failures) {
        const tenantId = tenantIdFromKey(key)
        if (tenantId) {
          await enqueueCleanup(pool, tenantId, key, false, store.id).catch((err) =>
            logger.error('storage.cleanup_enqueue_failed', { err, tenantId }),
          )
        }
      }
      if (failures.length) throw failures[0].result.reason
      return results[0].value
    })
  }
  // Refresh only after a successful delete. Return the original promise so the
  // caller's rejection timing is unchanged (safeRemove relies on it); the
  // no-op reject handler here keeps this branch from surfacing as an unhandled
  // rejection — the caller still sees the original error.
  promise.then(() => refreshTenantStorageForKey(key), () => {})
  return promise
}

export function removeObjectFromStore(key, storeTarget = 'routed') {
  if (storeTarget === 'routed') return removeObject(key)
  if (storeTarget === 'both') {
    return Promise.all([
      PUBLIC_STORE.client.removeObject(PUBLIC_STORE.bucket, key),
      PRIVATE_STORE.client.removeObject(PRIVATE_STORE.bucket, key),
    ])
  }
  const store = storeTarget === 'public' ? PUBLIC_STORE : PRIVATE_STORE
  return store.client.removeObject(store.bucket, key)
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

function listObjects(store, prefix, includeVersions = false) {
  return new Promise((resolve, reject) => {
    const objects = []
    const stream = includeVersions
      ? store.client.listObjects(store.bucket, prefix, true, { IncludeVersion: true })
      : store.client.listObjectsV2(store.bucket, prefix, true)
    stream.on('data', (obj) => {
      if (obj.name) objects.push(obj)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(objects))
  })
}

async function removeBatches(store, entries) {
  for (let i = 0; i < entries.length; i += 1000) {
    const failures = await store.client.removeObjects(store.bucket, entries.slice(i, i + 1000))
    if (failures.length) throw new Error('Tenant object deletion failed')
  }
}

async function purgeCurrentObjects(store, prefix, exactKeys = []) {
  const listed = (await listObjects(store, prefix)).map(({ name }) => name)
  const keys = [...new Set([...listed, ...exactKeys])]
  await removeBatches(store, keys)
  if ((await listObjects(store, prefix)).length) {
    throw new Error('Tenant storage prefix is not empty after deletion')
  }
}

async function purgeAllVersions(store, prefix) {
  while (true) {
    const versions = await listObjects(store, prefix, true)
    if (!versions.length) return
    await removeBatches(store, versions.map(({ name, versionId }) => ({ name, versionId })))
  }
}

// Permanently removes every object owned by a tenant. Modern assets are found
// by prefix, including unreferenced leftovers; exact legacy keys are supplied
// by the database because old unprefixed objects cannot encode ownership.
export async function deleteTenantObjects(tenantId, legacyKeys = []) {
  const prefix = `tenants/${tenantId}/`
  const exactPublicKeys = legacyKeys.filter(Boolean).filter((key) => storeForKey(key).id === 'public')
  await purgeCurrentObjects(PUBLIC_STORE, prefix, exactPublicKeys)
  if (!sameStore(PRIVATE_STORE, PUBLIC_STORE)) {
    await purgeAllVersions(PRIVATE_STORE, prefix)
    if ((await listObjects(PRIVATE_STORE, prefix, true)).length) {
      throw new Error('Tenant storage versions are not empty after deletion')
    }
  }
}
