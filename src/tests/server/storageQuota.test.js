import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

// In-memory object store standing in for S3/RustFS: deterministic quota tests
// against the real Postgres (tenant_statistics, subscriptions, cleanup queue).
const store = new Map()
let putFailure = null
let removeFailure = null

function listStream(prefix) {
  return Readable.from(
    [...store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([name, size]) => ({ name, size })),
  )
}

vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async (_bucket, key, _buffer, size) => {
      if (putFailure) throw putFailure
      store.set(key, size)
      return { etag: 'test' }
    }),
    removeObject: vi.fn(async (_bucket, key) => {
      if (removeFailure) throw removeFailure
      store.delete(key)
    }),
    listObjects: vi.fn((_bucket, prefix) => listStream(prefix)),
    listObjectsV2: vi.fn((_bucket, prefix) => listStream(prefix)),
    removeObjects: vi.fn(async () => []),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
  },
}))

// Song documents are content-verified before upload; not under test here.
vi.mock('../../../server/utils/verifyFileContent.js', () => ({
  verifyDocumentContent: vi.fn(() => true),
  verifyRecordingContent: vi.fn(() => true),
  verifyImageContent: vi.fn(() => true),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearEntitlementCaches
let uploadObjectWithQuota, StorageQuotaError
let runReconciliationTick
let billing
let request
let seed

const KB = 1024
const MB = 1024 * 1024

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  const entMod = await import('../../../server/services/entitlementService.js')
  clearEntitlementCaches = entMod.clearEntitlementCaches
  const storageMod = await import('../../../server/services/storageService.js')
  uploadObjectWithQuota = storageMod.uploadObjectWithQuota
  StorageQuotaError = storageMod.StorageQuotaError
  const jobMod = await import('../../../server/jobs/billingReconciliation.js')
  runReconciliationTick = jobMod.runReconciliationTick
  billing = await import('./_billing.js')
  request = (await import('supertest')).default
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
  store.clear()
  putFailure = null
  removeFailure = null
})

afterAll(async () => {
  await pool.end()
})

// Gold subscription with a storage override (MB), owned by userA on tenantA.
async function ownWithStorageLimit(storageMb) {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
  return billing.createSubscription({
    userId: seed.userA.id,
    planSlug: 'gold',
    entitlement_overrides: { limits: { storage_mb: storageMb } },
  })
}

async function usageOf(tenantId) {
  const { rows: [row] } = await pool.query(
    'SELECT COALESCE(storage_bytes, 0)::int AS bytes FROM tenant_statistics WHERE tenant_id = $1',
    [tenantId],
  )
  return row?.bytes ?? 0
}

function key(name) {
  return `tenants/${seed.tenantA.id}/share/${name}`
}

const buf = (size) => Buffer.alloc(size)

describe('uploadObjectWithQuota', () => {
  it('uploads under the limit and reserves usage', async () => {
    await ownWithStorageLimit(1)
    await uploadObjectWithQuota(key('a.jpg'), buf(500 * KB), 500 * KB, 'image/jpeg')
    expect(store.has(key('a.jpg'))).toBe(true)
    expect(await usageOf(seed.tenantA.id)).toBe(500 * KB)
  })

  it('rejects an upload that would exceed the limit with a 413', async () => {
    await ownWithStorageLimit(1)
    await uploadObjectWithQuota(key('a.jpg'), buf(700 * KB), 700 * KB, 'image/jpeg')

    let caught
    try {
      await uploadObjectWithQuota(key('b.jpg'), buf(700 * KB), 700 * KB, 'image/jpeg')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(StorageQuotaError)
    expect(caught.status).toBe(413)
    expect(caught.code).toBe('storage_limit_exceeded')
    expect(store.has(key('b.jpg'))).toBe(false)
    expect(await usageOf(seed.tenantA.id)).toBe(700 * KB)
  })

  it('parallel uploads near the limit: exactly one passes', async () => {
    await ownWithStorageLimit(1)
    const results = await Promise.allSettled([
      uploadObjectWithQuota(key('p1.jpg'), buf(700 * KB), 700 * KB, 'image/jpeg'),
      uploadObjectWithQuota(key('p2.jpg'), buf(700 * KB), 700 * KB, 'image/jpeg'),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.status).toBe(413)
    expect(await usageOf(seed.tenantA.id)).toBe(700 * KB)
  })

  it('ownerless tenants are never quota-blocked', async () => {
    const bigKey = `tenants/${seed.tenantB.id}/share/big.jpg`
    await uploadObjectWithQuota(bigKey, buf(10 * MB), 10 * MB, 'image/jpeg')
    expect(store.has(bigKey)).toBe(true)
  })

  it('a failed put releases the reservation once the object is confirmed gone', async () => {
    await ownWithStorageLimit(1)
    putFailure = new Error('S3 down')
    await expect(
      uploadObjectWithQuota(key('fail.jpg'), buf(300 * KB), 300 * KB, 'image/jpeg'),
    ).rejects.toThrow('S3 down')
    expect(await usageOf(seed.tenantA.id)).toBe(0)
    const { rows } = await pool.query('SELECT * FROM storage_cleanup_queue')
    expect(rows).toHaveLength(0)
  })

  it('an unconfirmable failed put keeps the reservation and queues cleanup; the drain reconciles', async () => {
    await ownWithStorageLimit(1)
    putFailure = new Error('S3 down')
    removeFailure = new Error('still down')
    await expect(
      uploadObjectWithQuota(key('orphan.jpg'), buf(300 * KB), 300 * KB, 'image/jpeg'),
    ).rejects.toThrow('S3 down')

    // Reservation held (conservative) + queue row waiting.
    expect(await usageOf(seed.tenantA.id)).toBe(300 * KB)
    const { rows: [queued] } = await pool.query('SELECT * FROM storage_cleanup_queue')
    expect(queued.object_key).toBe(key('orphan.jpg'))
    expect(queued.release_reservation).toBe(true)

    // Drain while removal still fails → attempts bumped, row kept.
    await runReconciliationTick()
    const { rows: [afterFail] } = await pool.query('SELECT attempts FROM storage_cleanup_queue')
    expect(afterFail.attempts).toBe(1)
    expect(await usageOf(seed.tenantA.id)).toBe(300 * KB)

    // Storage recovers → drain removes the row and reconciles usage.
    removeFailure = null
    await runReconciliationTick()
    const { rows: remaining } = await pool.query('SELECT * FROM storage_cleanup_queue')
    expect(remaining).toHaveLength(0)
    expect(await usageOf(seed.tenantA.id)).toBe(0)
  })
})

describe('route-level enforcement', () => {
  const asUserA = (req) =>
    req
      .set('x-test-user-id', String(seed.userA.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))

  it('an upload endpoint surfaces the quota as a 413', async () => {
    await ownWithStorageLimit(0) // no storage allowance at all
    const song = await asUserA(request(app).post('/api/songs').send({ title: 'Song' })).expect(201)
    const res = await asUserA(
      request(app)
        .post(`/api/songs/${song.body.id}/documents`)
        .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'chart.pdf', contentType: 'application/pdf' }),
    )
    expect(res.status).toBe(413)
  })
})
