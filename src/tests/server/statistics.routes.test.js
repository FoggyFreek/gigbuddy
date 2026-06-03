import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function as(userId, tenantId) {
  return (req) =>
    req
      .set('x-test-user-id', String(userId))
      .set('x-test-tenant-id', tenantId === null ? 'null' : String(tenantId))
}

const asUserA = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asSuper = (req, tenantId = seed.tenantA.id) => as(seed.superUser.id, tenantId)(req)

// Insert a stats row directly so we can assert reads without hitting S3.
async function setStats(tenantId, storageBytes, objectCount) {
  await pool.query(
    `INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id)
     DO UPDATE SET storage_bytes = $2, object_count = $3`,
    [tenantId, storageBytes, objectCount],
  )
}

describe('GET /api/statistics/storage — tenant admin, own tenant', () => {
  it('returns the active tenant row with its usage', async () => {
    await setStats(seed.tenantA.id, 4096, 3)
    // userA is tenant_admin of tenantA per seed.
    const res = await asUserA(request(app).get('/api/statistics/storage')).expect(200)
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
    expect(Number(res.body.storage_bytes)).toBe(4096)
    expect(res.body.object_count).toBe(3)
  })

  it('returns zeros for a tenant with no stats row yet (COALESCE)', async () => {
    // tenantA has no tenant_statistics row (seed does not create one).
    const res = await asUserA(request(app).get('/api/statistics/storage')).expect(200)
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
    expect(Number(res.body.storage_bytes)).toBe(0)
    expect(res.body.object_count).toBe(0)
  })

  it('does not leak another tenant\'s usage', async () => {
    await setStats(seed.tenantB.id, 999999, 42)
    const res = await asUserA(request(app).get('/api/statistics/storage')).expect(200)
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
    expect(Number(res.body.storage_bytes)).toBe(0)
  })

  it('403s a plain member (tenant_admin required)', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'member' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await asUserA(request(app).get('/api/statistics/storage')).expect(403)
  })
})

describe('GET /api/admin/statistics/storage — super admin, all tenants', () => {
  it('403s a non-super-admin (even a tenant admin)', async () => {
    await asUserA(request(app).get('/api/admin/statistics/storage')).expect(403)
  })

  it('returns a row for every tenant, including zero-usage ones', async () => {
    await setStats(seed.tenantA.id, 2048, 1)
    // tenantB intentionally has no row.
    const res = await asSuper(request(app).get('/api/admin/statistics/storage')).expect(200)
    expect(res.body).toHaveLength(2)
    const a = res.body.find((r) => r.tenant_id === seed.tenantA.id)
    const b = res.body.find((r) => r.tenant_id === seed.tenantB.id)
    expect(Number(a.storage_bytes)).toBe(2048)
    expect(Number(b.storage_bytes)).toBe(0)
    expect(b.slug).toBe('beta')
  })
})
