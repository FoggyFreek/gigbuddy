import { createHash, randomUUID } from 'node:crypto'
import { BUCKET, STORAGE_INFO, storageClient } from '../utils/storage.js'

const PROBE_PREFIX = 'tenants/0/_connection-probe/'

function safeProviderCode(err) {
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

async function hashReadable(stream) {
  const hash = createHash('sha256')
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function purgeProbeVersions(prefix) {
  while (true) {
    const versions = await collectStream(
      storageClient.listObjects(BUCKET, prefix, true, { IncludeVersion: true }),
    )
    if (!versions.length) return
    const failures = await storageClient.removeObjects(
      BUCKET,
      versions.map(({ name, versionId }) => ({ name, versionId })),
    )
    if (failures.length) throw new Error('Storage connection probe cleanup failed')
  }
}

function connectionResult(overrides) {
  return { ...STORAGE_INFO, ...overrides }
}

export async function getStorageConnection() {
  try {
    const connected = await storageClient.bucketExists(BUCKET)
    return connectionResult({
      connected: !!connected,
      operationsVerified: false,
      errorCode: connected ? null : 'bucket_not_found',
    })
  } catch (err) {
    return connectionResult({
      connected: false,
      operationsVerified: false,
      errorCode: safeProviderCode(err),
    })
  }
}

export async function testStorageConnection() {
  const prefix = `${PROBE_PREFIX}${randomUUID()}`
  const key = `${prefix}/probe.txt`
  const content = Buffer.from('gigbuddy-storage-probe')
  try {
    if (!(await storageClient.bucketExists(BUCKET))) {
      return connectionResult({
        connected: false,
        operationsVerified: false,
        errorCode: 'bucket_not_found',
      })
    }
    await storageClient.putObject(BUCKET, key, content, content.length, { 'Content-Type': 'text/plain' })
    const stat = await storageClient.statObject(BUCKET, key)
    const downloaded = await hashReadable(await storageClient.getObject(BUCKET, key))
    const listed = await collectStream(storageClient.listObjectsV2(BUCKET, prefix, true))
    const expectedHash = createHash('sha256').update(content).digest('hex')
    if (Number(stat.size) !== content.length || downloaded !== expectedHash || !listed.some((item) => item.name === key)) {
      throw new Error('Storage connection probe content mismatch')
    }
    await storageClient.removeObject(BUCKET, key)
    await purgeProbeVersions(prefix)
    return connectionResult({ connected: true, operationsVerified: true, errorCode: null })
  } catch (err) {
    await purgeProbeVersions(prefix).catch(() => {})
    return connectionResult({
      connected: false,
      operationsVerified: false,
      errorCode: safeProviderCode(err),
    })
  }
}
