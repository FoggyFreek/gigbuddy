import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteTenantObjects: vi.fn(async () => undefined),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, deleteTenantObjects
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const storageMod = await import('../../../server/platform/files/storageService.js')
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

const removeSelf = (tenant, body = {}) => request(app)
  .delete(`/api/tenants/${tenant.id}`)
  .send({
    confirmationName: `${tenant.slug[0].toUpperCase()}${tenant.slug.slice(1)} Band`,
    acknowledged: true,
    ...body,
  })

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

  it('deletes S3 data and cascades only the selected tenant database data', async () => {
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
      'UPDATE tenants SET archived_at = NOW() WHERE id = $1',
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO dashboard_tiles (tenant_id, type, image_path)
       VALUES ($1, 'memory_tile', $2)`,
      [seed.tenantA.id, memoryKey],
    )
    await asSuper(remove(seed.tenantA)).expect(204)
    expect(deleteTenantObjects).toHaveBeenCalledWith(
      seed.tenantA.id,
      expect.arrayContaining([memoryKey]),
    )
  })

  it('keeps the archived tenant when S3 cleanup fails so deletion can be retried', async () => {
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

describe('DELETE /api/tenants/:id (self-service)', () => {
  it('lets a band tenant_admin archive and permanently delete the tenant', async () => {
    let archivedBeforeStoragePurge = false
    deleteTenantObjects.mockImplementationOnce(async (tenantId) => {
      const { rows: [tenant] } = await pool.query(
        'SELECT archived_at FROM tenants WHERE id = $1', [tenantId],
      )
      archivedBeforeStoragePurge = tenant.archived_at !== null
    })

    await asUserA(removeSelf(seed.tenantA)).expect(204)

    expect(archivedBeforeStoragePurge).toBe(true)
    expect(deleteTenantObjects).toHaveBeenCalledWith(
      seed.tenantA.id,
      expect.arrayContaining([seed.sharePhotos.find((p) => p.tenant_id === seed.tenantA.id).object_key]),
    )
    const tenants = await pool.query('SELECT id FROM tenants ORDER BY id')
    expect(tenants.rows).toEqual([{ id: seed.tenantB.id }])
  })

  it('requires the exact visible name and explicit acknowledgement before archiving', async () => {
    await asUserA(removeSelf(seed.tenantA, { confirmationName: 'alpha band' })).expect(400)
    await asUserA(removeSelf(seed.tenantA, { acknowledged: false })).expect(400)

    const { rows: [tenant] } = await pool.query(
      'SELECT archived_at, deletion_status FROM tenants WHERE id = $1', [seed.tenantA.id],
    )
    expect(tenant).toEqual({ archived_at: null, deletion_status: null })
    expect(deleteTenantObjects).not.toHaveBeenCalled()
  })

  it('denies non-admin members and conceals tenants from non-members', async () => {
    await pool.query(
      "UPDATE memberships SET role = 'contributor' WHERE user_id = $1 AND tenant_id = $2",
      [seed.userA.id, seed.tenantA.id],
    )
    await asUserA(removeSelf(seed.tenantA)).expect(403)

    await request(app)
      .delete(`/api/tenants/${seed.tenantA.id}`)
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .send({ confirmationName: 'Alpha Band', acknowledged: true })
      .expect(404)

    expect(deleteTenantObjects).not.toHaveBeenCalled()
  })

  it('leaves a failed purge archived and retryable', async () => {
    deleteTenantObjects.mockRejectedValueOnce(new Error('storage unavailable'))
    await asUserA(removeSelf(seed.tenantA)).expect(502)

    const { rows: [failed] } = await pool.query(
      'SELECT archived_at, deletion_status FROM tenants WHERE id = $1', [seed.tenantA.id],
    )
    expect(failed.archived_at).toBeTruthy()
    expect(failed.deletion_status).toBe('failed')

    await asUserA(removeSelf(seed.tenantA)).expect(204)
    const { rowCount } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(rowCount).toBe(0)
  })

  it('deletes only an artist workspace while retaining the user and user-level data', async () => {
    const { rows: [workspace] } = await pool.query(
      `INSERT INTO tenants (slug, band_name, display_name, kind, owner_user_id, created_by_user_id)
       VALUES ('alpha-artist', 'Alpha Artist', 'Alpha Artist', 'personal', $1, $1)
       RETURNING *`,
      [seed.userA.id],
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
       VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
      [seed.userA.id, workspace.id],
    )
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2026-09-01', 'Artist gig')`,
      [workspace.id],
    )
    await pool.query(
      `INSERT INTO user_availability_slots (user_id, start_date, end_date, status)
       VALUES ($1, '2026-09-01', '2026-09-01', 'unavailable')`,
      [seed.userA.id],
    )
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, audience, status, billing_interval, price_cents)
       SELECT $1, id, audience, 'active', 'month', 0
         FROM subscription_plans
        WHERE audience = 'artist' AND is_fallback = TRUE`,
      [seed.userA.id],
    )

    await request(app)
      .delete(`/api/tenants/${workspace.id}`)
      .set('x-test-user-id', String(seed.userA.id))
      .set('x-test-tenant-id', String(workspace.id))
      .send({ confirmationName: 'Alpha Artist', acknowledged: true })
      .expect(204)

    expect((await pool.query('SELECT 1 FROM tenants WHERE id = $1', [workspace.id])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM gigs WHERE tenant_id = $1', [workspace.id])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM users WHERE id = $1', [seed.userA.id])).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM subscriptions WHERE user_id = $1', [seed.userA.id])).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM user_availability_slots WHERE user_id = $1', [seed.userA.id])).rowCount).toBe(1)
    expect((await pool.query(
      'SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, seed.tenantA.id],
    )).rowCount).toBe(1)
  })
})
