import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../../server/services/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteTenantObjects: vi.fn(async () => undefined),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, deleteTenantObjects
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const storageMod = await import('../../../server/services/storageService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  deleteTenantObjects = storageMod.deleteTenantObjects
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  deleteTenantObjects.mockReset().mockResolvedValue(undefined)
})

afterAll(async () => pool.end())

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asSuper = (req) => req
  .set('x-test-user-id', String(seed.superUser.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

const remove = (tenant, confirmationSlug = tenant.slug) =>
  request(app).delete(`/api/admin/tenants/${tenant.id}`).send({ confirmationSlug })

describe('DELETE /api/admin/tenants/:id', () => {
  it('requires a super admin and an archived tenant', async () => {
    await asUserA(remove(seed.tenantA)).expect(403)
    await asSuper(remove(seed.tenantA)).expect(409)
    expect(deleteTenantObjects).not.toHaveBeenCalled()
  })

  it('requires the exact tenant slug', async () => {
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    await asSuper(remove(seed.tenantA, 'wrong')).expect(400)
    await asSuper(remove(seed.tenantA, seed.tenantA.slug.toUpperCase())).expect(400)
    expect(deleteTenantObjects).not.toHaveBeenCalled()
  })

  it('deletes RustFS data and cascades only the selected tenant database data', async () => {
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    const res = await asSuper(remove(seed.tenantA)).expect(204)
    expect(res.body).toEqual({})
    expect(deleteTenantObjects).toHaveBeenCalledWith(
      seed.tenantA.id,
      expect.arrayContaining([seed.sharePhotos.find((p) => p.tenant_id === seed.tenantA.id).object_key]),
    )
    const tenants = await pool.query('SELECT id FROM tenants ORDER BY id')
    expect(tenants.rows).toEqual([{ id: seed.tenantB.id }])
    const tenantARows = await pool.query('SELECT 1 FROM gigs WHERE tenant_id = $1', [seed.tenantA.id])
    const tenantBRows = await pool.query('SELECT 1 FROM gigs WHERE tenant_id = $1', [seed.tenantB.id])
    expect(tenantARows.rowCount).toBe(0)
    expect(tenantBRows.rowCount).toBeGreaterThan(0)
  })

  it('includes the dashboard memory-tile image among the purged object keys', async () => {
    const memoryKey = `tenants/${seed.tenantA.id}/memory/deadbeef.jpg`
    await pool.query(
      'UPDATE tenants SET archived_at = NOW(), memory_image_path = $2 WHERE id = $1',
      [seed.tenantA.id, memoryKey],
    )
    await asSuper(remove(seed.tenantA)).expect(204)
    expect(deleteTenantObjects).toHaveBeenCalledWith(
      seed.tenantA.id,
      expect.arrayContaining([memoryKey]),
    )
  })

  it('keeps the archived tenant when RustFS cleanup fails so deletion can be retried', async () => {
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    deleteTenantObjects.mockRejectedValueOnce(new Error('storage unavailable'))
    await asSuper(remove(seed.tenantA)).expect(502)
    const tenant = await pool.query('SELECT archived_at FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.rowCount).toBe(1)
    expect(tenant.rows[0].archived_at).toBeTruthy()
  })

  it('returns 404 for a missing tenant', async () => {
    await asSuper(request(app).delete('/api/admin/tenants/999999').send({ confirmationSlug: 'missing' }))
      .expect(404)
  })
})
