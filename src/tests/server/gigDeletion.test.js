import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// safeRemove is fire-and-forget against the object store; spying on it is the
// only way to observe which keys a delete actually reclaims.
vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  safeRemove: vi.fn(() => undefined),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, safeRemove
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const storageMod = await import('../../../server/platform/files/storageService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  safeRemove = storageMod.safeRemove
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  safeRemove.mockClear()
})

afterAll(async () => pool.end())

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

const removedKeys = () => safeRemove.mock.calls.map(([key]) => key)

async function attachBanner(gigId, tenantId, key) {
  await pool.query('UPDATE gigs SET banner_path = $1 WHERE id = $2 AND tenant_id = $3', [key, gigId, tenantId])
}

async function attachFile(gigId, tenantId, key) {
  await pool.query(
    `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, 'rider.pdf', 'application/pdf', 1024)`,
    [gigId, tenantId, key],
  )
}

describe('DELETE /api/gigs/:id storage reclamation', () => {
  it('removes the banner and every attachment object', async () => {
    const { id: gigId } = seed.gigA
    const tenantId = seed.tenantA.id
    await attachBanner(gigId, tenantId, `tenants/${tenantId}/gig-banners/banner.jpg`)
    await attachFile(gigId, tenantId, `tenants/${tenantId}/gig_attachments/rider.pdf`)
    await attachFile(gigId, tenantId, `tenants/${tenantId}/gig_attachments/stageplan.pdf`)

    await asUserA(request(app).delete(`/api/gigs/${gigId}`)).expect(204)

    expect(removedKeys().sort()).toEqual([
      `tenants/${tenantId}/gig-banners/banner.jpg`,
      `tenants/${tenantId}/gig_attachments/rider.pdf`,
      `tenants/${tenantId}/gig_attachments/stageplan.pdf`,
    ].sort())

    const { rowCount } = await pool.query('SELECT 1 FROM gig_attachments WHERE gig_id = $1', [gigId])
    expect(rowCount).toBe(0)
  })

  it('removes nothing when the gig owns no objects', async () => {
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}`)).expect(204)
    expect(safeRemove).not.toHaveBeenCalled()
  })

  it('does not reclaim another tenant\'s objects', async () => {
    const tenantB = seed.tenantB.id
    await attachBanner(seed.gigB.id, tenantB, `tenants/${tenantB}/gig-banners/b.jpg`)
    await attachFile(seed.gigB.id, tenantB, `tenants/${tenantB}/gig_attachments/b.pdf`)

    await asUserA(request(app).delete(`/api/gigs/${seed.gigB.id}`)).expect(404)

    expect(safeRemove).not.toHaveBeenCalled()
    const { rowCount } = await pool.query('SELECT 1 FROM gigs WHERE id = $1', [seed.gigB.id])
    expect(rowCount).toBe(1)
  })
})
