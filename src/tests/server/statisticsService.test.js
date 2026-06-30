import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import { EventEmitter } from 'events'

// Storage is mocked so computeTenantStorage reads from a fake object listing
// instead of a real RustFS; the DB is real (advisory-lock + upsert path).
let listing = []
function streamFrom(objects, errorMsg) {
  const stream = new EventEmitter()
  queueMicrotask(() => {
    if (errorMsg) return stream.emit('error', new Error(errorMsg))
    for (const o of objects) stream.emit('data', o)
    stream.emit('end')
  })
  return stream
}

vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    listObjects: vi.fn(() => streamFrom(listing)),
  },
}))

let pool, runMigrations, truncateAll, seedTwoTenants, svc, storage, seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  svc = await import('../../../server/services/statisticsService.js')
  storage = await import('../../../server/utils/storage.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants() // creates tenants; NO tenant_statistics rows
  listing = []
  storage.storageClient.listObjects.mockClear()
  storage.storageClient.listObjects.mockImplementation(() => streamFrom(listing))
})

afterAll(async () => {
  await pool.end()
})

describe('tenantIdFromKey', () => {
  it('parses the tenant id out of a scoped key', () => {
    expect(svc.tenantIdFromKey('tenants/42/gig-banners/abc.jpg')).toBe(42)
  })
  it('returns null for legacy / un-prefixed keys', () => {
    expect(svc.tenantIdFromKey('logo/old.png')).toBeNull()
    expect(svc.tenantIdFromKey('')).toBeNull()
    expect(svc.tenantIdFromKey(undefined)).toBeNull()
  })
})

describe('computeTenantStorage', () => {
  it('sums object sizes and counts them', async () => {
    listing = [{ size: 100 }, { size: 50 }, { size: 0 }]
    const res = await svc.computeTenantStorage(seed.tenantA.id)
    expect(res).toEqual({ storageBytes: 150, objectCount: 3 })
  })
  it('lists the tenant-scoped prefix', async () => {
    listing = []
    await svc.computeTenantStorage(seed.tenantA.id)
    expect(storage.storageClient.listObjects).toHaveBeenCalledWith(
      'test-bucket',
      `tenants/${seed.tenantA.id}/`,
      true,
    )
  })
})

describe('refreshTenantStorage', () => {
  it('upserts the tenant_statistics row from the current listing', async () => {
    listing = [{ size: 1000 }, { size: 200 }]
    await svc.refreshTenantStorage(seed.tenantA.id)
    const stats = await svc.getTenantStatistics(seed.tenantA.id)
    expect(Number(stats.storage_bytes)).toBe(1200)
    expect(stats.object_count).toBe(2)
    expect(stats.updated_at).toBeTruthy()

    // A second refresh with a smaller listing overwrites the total.
    listing = [{ size: 10 }]
    await svc.refreshTenantStorage(seed.tenantA.id)
    const after = await svc.getTenantStatistics(seed.tenantA.id)
    expect(Number(after.storage_bytes)).toBe(10)
    expect(after.object_count).toBe(1)
  })
})

describe('getTenantStatistics', () => {
  it('returns zeros (COALESCE) for a tenant with no stats row yet', async () => {
    const stats = await svc.getTenantStatistics(seed.tenantB.id)
    expect(Number(stats.storage_bytes)).toBe(0)
    expect(stats.object_count).toBe(0)
  })
})

describe('getAllTenantStatistics', () => {
  it('returns a row for every tenant, including zero-usage ones', async () => {
    listing = [{ size: 500 }]
    await svc.refreshTenantStorage(seed.tenantA.id)
    const all = await svc.getAllTenantStatistics()
    expect(all).toHaveLength(2)
    const a = all.find((r) => r.tenant_id === seed.tenantA.id)
    const b = all.find((r) => r.tenant_id === seed.tenantB.id)
    expect(Number(a.storage_bytes)).toBe(500)
    expect(Number(b.storage_bytes)).toBe(0) // never refreshed, still present
  })
})

describe('refreshTenantStorageForKey', () => {
  it('refreshes the tenant parsed from the key', async () => {
    listing = [{ size: 64 }]
    await svc.refreshTenantStorageForKey(`tenants/${seed.tenantA.id}/logo/x.png`)
    const stats = await svc.getTenantStatistics(seed.tenantA.id)
    expect(Number(stats.storage_bytes)).toBe(64)
  })
  it('is a no-op for a non-tenant key (no listing)', async () => {
    await svc.refreshTenantStorageForKey('logo/legacy.png')
    expect(storage.storageClient.listObjects).not.toHaveBeenCalled()
  })
  it('never throws when the listing errors (best-effort)', async () => {
    storage.storageClient.listObjects.mockImplementationOnce(() =>
      streamFrom([], 's3 down'),
    )
    const { logger } = await import('../../../server/utils/logger.js')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await expect(
      svc.refreshTenantStorageForKey(`tenants/${seed.tenantA.id}/logo/x.png`),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'tenant_storage.refresh_failed',
      expect.objectContaining({ err: expect.any(Error), tenantId: seed.tenantA.id }),
    )
    warn.mockRestore()
  })
})
