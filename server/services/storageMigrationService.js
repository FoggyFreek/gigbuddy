import { createHash, randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import pool from '../db/index.js'
import {
  PRIVATE_STORE,
  PUBLIC_STORE,
} from '../utils/storage.js'
import {
  parseTenantObjectKey,
  storeForKey,
  isObjectMissing,
} from './storageService.js'
import { refreshTenantStorage } from './statisticsService.js'
import { fetchTenantAssetKeys } from '../repositories/tenantRepository.js'
import {
  completeMigration,
  ensureMigration,
  getMigration,
  heartbeatMigration,
  listMigrations,
  markObjectVerified,
  queueMigration,
  replaceInventory,
} from '../repositories/storageMigrationRepository.js'
import { validateRustfsDeleteConfirmation } from '../validators/storageMigrationValidators.js'

const PROBE_PREFIX = 'tenants/0/_connection-probe/'

export class StorageMigrationError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'StorageMigrationError'
    this.code = code
  }
}

function safeProviderCode(err) {
  if (err instanceof StorageMigrationError) return err.code
  if (err?.code === 'AccessDenied' || err?.statusCode === 403) return 'access_denied'
  if (err?.code === 'NoSuchBucket') return 'bucket_not_found'
  if (err?.code === 'InvalidAccessKeyId' || err?.code === 'SignatureDoesNotMatch') return 'invalid_credentials'
  if (err?.code === 'SlowDown' || err?.statusCode === 429) return 'provider_throttled'
  return 'connection_failed'
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const objects = []
    stream.on('data', (object) => objects.push(object))
    stream.on('error', reject)
    stream.on('end', () => resolve(objects))
  })
}

function listCurrent(store, prefix) {
  return collectStream(store.client.listObjectsV2(store.bucket, prefix, true))
}

function listVersions(store, prefix) {
  return collectStream(store.client.listObjects(store.bucket, prefix, true, { IncludeVersion: true }))
}

async function removeBatches(store, entries) {
  for (let index = 0; index < entries.length; index += 1000) {
    const failures = await store.client.removeObjects(store.bucket, entries.slice(index, index + 1000))
    if (failures.length) throw new StorageMigrationError('delete_failed')
  }
}

async function hashReadable(stream) {
  const hash = createHash('sha256')
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function hashingTransform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
}

function contentTypeOf(stat) {
  return stat.metaData?.['content-type'] || stat.metaData?.['Content-Type'] || 'application/octet-stream'
}

function sourceFingerprint(stat) {
  return [stat.size || 0, stat.etag || '', stat.lastModified?.toISOString?.() || ''].join(':')
}

function inventoryFingerprint(objects) {
  const hash = createHash('sha256')
  for (const object of [...objects].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(`${object.name}\0${object.size}\0${object.fingerprint}\n`)
  }
  return hash.digest('hex')
}

async function scanTenantSource(tenantId) {
  const prefix = `tenants/${tenantId}/`
  const listed = await listCurrent(PUBLIC_STORE, prefix)
  const objects = []
  for (const object of listed) {
    const parsed = parseTenantObjectKey(object.name)
    if (!parsed || parsed.tenantId !== tenantId || storeForKey(object.name).id !== 'private') continue
    const stat = await PUBLIC_STORE.client.statObject(PUBLIC_STORE.bucket, object.name)
    objects.push({
      name: object.name,
      size: Number(stat.size || 0),
      contentType: contentTypeOf(stat),
      fingerprint: sourceFingerprint(stat),
    })
  }
  return {
    objects,
    sourceObjectCount: objects.length,
    sourceBytes: objects.reduce((sum, object) => sum + object.size, 0),
    inventoryFingerprint: inventoryFingerprint(objects),
  }
}

async function persistInventory(tenantId, inventory) {
  await replaceInventory(pool, tenantId, inventory.objects)
  await heartbeatMigration(pool, tenantId, inventory)
}

export async function getStorageMigration(tenantId) {
  return getMigration(pool, tenantId)
}

export async function getStorageMigrations() {
  return listMigrations(pool)
}

export async function requestStorageMigration(tenantId, action, userId, body = {}) {
  const tenant = await getMigration(pool, tenantId)
  if (!tenant) return { error: { status: 404, body: { error: 'Tenant not found' } } }
  if (action === 'delete_rustfs') {
    if (!['verified', 'delete_failed'].includes(tenant.state) || !tenant.validated_fingerprint) {
      return { error: { status: 409, body: { error: 'A fresh successful validation is required' } } }
    }
    const confirmation = validateRustfsDeleteConfirmation(body, tenant)
    if (confirmation.error) return confirmation
  }
  const queued = await queueMigration(pool, tenantId, action, userId)
  if (!queued) return { error: { status: 409, body: { error: 'A storage migration operation is already running' } } }
  return { migration: await getMigration(pool, tenantId) }
}

export async function runInventory(tenantId) {
  await ensureMigration(pool, tenantId)
  const inventory = await scanTenantSource(tenantId)
  await persistInventory(tenantId, inventory)
  const state = inventory.sourceObjectCount ? 'ready_to_copy' : 'not_required'
  return completeMigration(pool, tenantId, state, inventory)
}

async function copyAndVerifyObject(tenantId, object) {
  const stat = await PUBLIC_STORE.client.statObject(PUBLIC_STORE.bucket, object.name)
  const source = await PUBLIC_STORE.client.getObject(PUBLIC_STORE.bucket, object.name)
  const sourceHash = createHash('sha256')
  const stream = source.pipe(hashingTransform(sourceHash))
  await PRIVATE_STORE.client.putObject(
    PRIVATE_STORE.bucket,
    object.name,
    stream,
    stat.size,
    { 'Content-Type': contentTypeOf(stat) },
  )
  const sourceSha256 = sourceHash.digest('hex')
  const destinationStat = await PRIVATE_STORE.client.statObject(PRIVATE_STORE.bucket, object.name)
  const destinationSha256 = await hashReadable(
    await PRIVATE_STORE.client.getObject(PRIVATE_STORE.bucket, object.name),
  )
  if (Number(destinationStat.size) !== Number(stat.size) || destinationSha256 !== sourceSha256) {
    throw new StorageMigrationError('content_mismatch')
  }
  await markObjectVerified(pool, tenantId, {
    name: object.name,
    sourceSha256,
    destinationSize: Number(destinationStat.size),
    destinationSha256,
  })
  return Number(stat.size)
}

export async function runCopy(tenantId) {
  const inventory = await scanTenantSource(tenantId)
  await persistInventory(tenantId, inventory)
  let copiedObjectCount = 0
  let copiedBytes = 0
  for (const object of inventory.objects) {
    copiedBytes += await copyAndVerifyObject(tenantId, object)
    copiedObjectCount += 1
    await heartbeatMigration(pool, tenantId, { copiedObjectCount, copiedBytes })
  }
  return completeMigration(pool, tenantId, inventory.sourceObjectCount ? 'copied' : 'not_required', {
    ...inventory,
    copiedObjectCount,
    copiedBytes,
  })
}

async function hashStoreObject(store, key) {
  const stat = await store.client.statObject(store.bucket, key)
  const sha256 = await hashReadable(await store.client.getObject(store.bucket, key))
  return { size: Number(stat.size || 0), sha256 }
}

async function validateContents(tenantId) {
  const start = await scanTenantSource(tenantId)
  await persistInventory(tenantId, start)
  let mismatchCount = 0
  let missingObjectCount = 0
  let copiedBytes = 0
  for (const object of start.objects) {
    try {
      const [source, destination] = await Promise.all([
        hashStoreObject(PUBLIC_STORE, object.name),
        hashStoreObject(PRIVATE_STORE, object.name),
      ])
      if (source.size !== destination.size || source.sha256 !== destination.sha256) mismatchCount += 1
      else copiedBytes += destination.size
    } catch (err) {
      if (isObjectMissing(err)) missingObjectCount += 1
      else throw err
    }
    await heartbeatMigration(pool, tenantId, { mismatchCount, missingObjectCount })
  }

  const referencedPrivateKeys = (await fetchTenantAssetKeys(pool, tenantId))
    .filter((key) => storeForKey(key).id === 'private')
  for (const key of referencedPrivateKeys) {
    try {
      await PRIVATE_STORE.client.statObject(PRIVATE_STORE.bucket, key)
    } catch (err) {
      if (isObjectMissing(err)) missingObjectCount += 1
      else throw err
    }
  }

  const end = await scanTenantSource(tenantId)
  if (start.inventoryFingerprint !== end.inventoryFingerprint) {
    throw new StorageMigrationError('source_changed')
  }
  const result = {
    ...end,
    copiedObjectCount: end.sourceObjectCount - missingObjectCount - mismatchCount,
    copiedBytes,
    databaseReferencesChecked: referencedPrivateKeys.length,
    missingObjectCount,
    mismatchCount,
    validatedFingerprint: end.inventoryFingerprint,
    validatedAt: new Date(),
  }
  await heartbeatMigration(pool, tenantId, result)
  if (missingObjectCount) throw new StorageMigrationError('missing_objects')
  if (mismatchCount) throw new StorageMigrationError('content_mismatch')
  return result
}

export async function runValidation(tenantId) {
  const result = await validateContents(tenantId)
  return completeMigration(pool, tenantId, result.sourceObjectCount ? 'verified' : 'not_required', result)
}

export async function runRustfsDelete(tenantId) {
  const before = await getMigration(pool, tenantId)
  if (!before || before.state !== 'deleting_source' || !before.validated_fingerprint) {
    throw new StorageMigrationError('validation_required')
  }
  const validation = await validateContents(tenantId)
  await removeBatches(PUBLIC_STORE, validation.objects.map(({ name }) => name))
  const remaining = await scanTenantSource(tenantId)
  if (remaining.sourceObjectCount) {
    throw new StorageMigrationError('rustfs_not_empty')
  }
  const referencedPrivateKeys = (await fetchTenantAssetKeys(pool, tenantId))
    .filter((key) => storeForKey(key).id === 'private')
  for (const key of referencedPrivateKeys) {
    await PRIVATE_STORE.client.statObject(PRIVATE_STORE.bucket, key)
  }
  await refreshTenantStorage(tenantId)
  return completeMigration(pool, tenantId, 'complete', {
    ...remaining,
    copiedObjectCount: validation.copiedObjectCount,
    copiedBytes: validation.copiedBytes,
    databaseReferencesChecked: referencedPrivateKeys.length,
  })
}

async function purgeProbeVersions(prefix) {
  while (true) {
    const versions = await listVersions(PRIVATE_STORE, prefix)
    if (!versions.length) return
    await removeBatches(PRIVATE_STORE, versions.map(({ name, versionId }) => ({ name, versionId })))
  }
}

export async function getPrivateStorageConnection() {
  try {
    const connected = await PRIVATE_STORE.client.bucketExists(PRIVATE_STORE.bucket)
    return { configured: true, connected: !!connected, operationsVerified: false, errorCode: connected ? null : 'bucket_not_found' }
  } catch (err) {
    return { configured: true, connected: false, operationsVerified: false, errorCode: safeProviderCode(err) }
  }
}

export async function testPrivateStorageConnection() {
  const prefix = `${PROBE_PREFIX}${randomUUID()}`
  const key = `${prefix}/probe.txt`
  const content = Buffer.from('gigbuddy-storage-probe')
  try {
    if (!(await PRIVATE_STORE.client.bucketExists(PRIVATE_STORE.bucket))) {
      throw new StorageMigrationError('bucket_not_found')
    }
    await PRIVATE_STORE.client.putObject(PRIVATE_STORE.bucket, key, content, content.length, { 'Content-Type': 'text/plain' })
    const stat = await PRIVATE_STORE.client.statObject(PRIVATE_STORE.bucket, key)
    const downloaded = await hashReadable(await PRIVATE_STORE.client.getObject(PRIVATE_STORE.bucket, key))
    const listed = await listCurrent(PRIVATE_STORE, prefix)
    if (Number(stat.size) !== content.length || downloaded !== createHash('sha256').update(content).digest('hex') || !listed.some((item) => item.name === key)) {
      throw new StorageMigrationError('probe_content_mismatch')
    }
    await PRIVATE_STORE.client.removeObject(PRIVATE_STORE.bucket, key)
    await purgeProbeVersions(prefix)
    return { configured: true, connected: true, operationsVerified: true, errorCode: null }
  } catch (err) {
    await purgeProbeVersions(prefix).catch(() => {})
    return { configured: true, connected: false, operationsVerified: false, errorCode: safeProviderCode(err) }
  }
}
