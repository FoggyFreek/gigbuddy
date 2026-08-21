import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants, billing
let seed

beforeAll(async () => {
  process.env.LINKPAGE_SECRET = ''
  process.env.LINKPAGE_URL = ''
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billing = await import('./_billing.js')
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => pool.end())

const as = (userId, tenantId, req) => req
  .set('x-test-user-id', String(userId))
  .set('x-test-tenant-id', String(tenantId))

const patchSlug = (userId, tenantId, slug, extra = {}) => as(
  userId,
  tenantId,
  request(app).patch('/api/tenant/slug').send({ slug, ...extra }),
)

async function grantGold(tenant, user) {
  await billing.setTenantOwner(tenant.id, user.id)
  return billing.createSubscription({ userId: user.id, planSlug: 'gold' })
}

describe('PATCH /api/tenant/slug', () => {
  it('changes only the active band tenant for a Gold tenant admin', async () => {
    await grantGold(seed.tenantA, seed.userA)

    const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live', {
      tenantId: seed.tenantB.id,
    }).expect(200)

    expect(res.body).toEqual({ slug: 'alpha-live', linkpageSync: 'pending' })
    const { rows } = await pool.query('SELECT id, slug, slug_revision FROM tenants ORDER BY id')
    expect(rows).toEqual([
      { id: seed.tenantA.id, slug: 'alpha-live', slug_revision: '1' },
      { id: seed.tenantB.id, slug: 'beta', slug_revision: '0' },
    ])
    const { rows: operations } = await pool.query(
      `SELECT tenant_id, old_slug, new_slug, slug_revision, status, attempt_count, last_error_code
         FROM linkpage_slug_sync_operations`,
    )
    expect(operations).toEqual([{
      tenant_id: seed.tenantA.id,
      old_slug: 'alpha',
      new_slug: 'alpha-live',
      slug_revision: '1',
      status: 'pending',
      attempt_count: 1,
      last_error_code: 'not_configured',
    }])
  })

  it('treats the current normalized slug as a no-op', async () => {
    await grantGold(seed.tenantA, seed.userA)

    const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha').expect(200)

    expect(res.body).toEqual({ slug: 'alpha' })
    const { rows: [tenant] } = await pool.query(
      'SELECT slug, slug_revision FROM tenants WHERE id = $1',
      [seed.tenantA.id],
    )
    expect(tenant).toEqual({ slug: 'alpha', slug_revision: '0' })
    expect((await pool.query('SELECT 1 FROM linkpage_slug_sync_operations')).rowCount).toBe(0)
  })

  it('requires the custom_slug entitlement', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)

    const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live').expect(403)
    expect(res.body).toMatchObject({ code: 'entitlement_required', feature: 'custom_slug' })
  })

  it('requires tenant.manage and rejects personal workspaces', async () => {
    const subscription = await grantGold(seed.tenantA, seed.userA)
    await pool.query(
      "UPDATE memberships SET role = 'contributor' WHERE tenant_id = $1 AND user_id = $2",
      [seed.tenantA.id, seed.userA.id],
    )
    await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live').expect(403)

    const personal = await billing.createPersonalTenant(seed.userA.id)
    await billing.createSubscriptionModule(subscription.id, { planSlug: 'artist_gold' })
    const personalRes = await patchSlug(seed.userA.id, personal.id, 'solo-live').expect(403)
    expect(personalRes.body.code).toBe('tenant_kind_not_supported')
  })

  it('rejects invalid and duplicate slugs without changing the tenant', async () => {
    await grantGold(seed.tenantA, seed.userA)

    const invalid = await patchSlug(seed.userA.id, seed.tenantA.id, 'Not valid!').expect(400)
    expect(invalid.body.code).toBe('invalid_slug')

    const duplicate = await patchSlug(seed.userA.id, seed.tenantA.id, seed.tenantB.slug).expect(409)
    expect(duplicate.body.code).toBe('slug_in_use')

    const { rows: [tenant] } = await pool.query('SELECT slug FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.slug).toBe(seed.tenantA.slug)
    expect((await pool.query('SELECT 1 FROM linkpage_slug_sync_operations')).rowCount).toBe(0)
  })

  it('keeps the committed slug and queues a retry when LinkBuddy is unavailable', async () => {
    await grantGold(seed.tenantA, seed.userA)
    process.env.LINKPAGE_SECRET = 'test-linkpage-secret'
    process.env.LINKPAGE_URL = 'https://link.test.local'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))

    try {
      const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-offline').expect(200)
      expect(res.body).toEqual({ slug: 'alpha-offline', linkpageSync: 'pending' })
      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(await pool.query("SELECT 1 FROM tenants WHERE id = $1 AND slug = 'alpha-offline'", [seed.tenantA.id]))
        .toHaveProperty('rowCount', 1)
      const { rows: [operation] } = await pool.query(
        'SELECT status, attempt_count, last_error_code FROM linkpage_slug_sync_operations WHERE tenant_id = $1',
        [seed.tenantA.id],
      )
      expect(operation).toEqual({ status: 'pending', attempt_count: 1, last_error_code: 'network_error' })
    } finally {
      fetchSpy.mockRestore()
      process.env.LINKPAGE_SECRET = ''
      process.env.LINKPAGE_URL = ''
    }
  })

  it('does not immediately deliver a later revision while an earlier one is unresolved', async () => {
    await grantGold(seed.tenantA, seed.userA)
    process.env.LINKPAGE_SECRET = 'test-linkpage-secret'
    process.env.LINKPAGE_URL = 'https://link.test.local'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))

    try {
      await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-one').expect(200)
      await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-two').expect(200)

      expect(fetchSpy).toHaveBeenCalledOnce()
      const { rows } = await pool.query(
        `SELECT slug_revision, status, attempt_count
           FROM linkpage_slug_sync_operations
          WHERE tenant_id = $1
          ORDER BY slug_revision`,
        [seed.tenantA.id],
      )
      expect(rows).toEqual([
        { slug_revision: '1', status: 'pending', attempt_count: 1 },
        { slug_revision: '2', status: 'pending', attempt_count: 0 },
      ])
    } finally {
      fetchSpy.mockRestore()
      process.env.LINKPAGE_SECRET = ''
      process.env.LINKPAGE_URL = ''
    }
  })

  it('releases the old slug for immediate reuse', async () => {
    await grantGold(seed.tenantA, seed.userA)
    await grantGold(seed.tenantB, seed.userB)

    await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live').expect(200)
    await patchSlug(seed.userB.id, seed.tenantB.id, 'alpha').expect(200)

    const { rows } = await pool.query('SELECT id, slug FROM tenants ORDER BY id')
    expect(rows).toEqual([
      { id: seed.tenantA.id, slug: 'alpha-live' },
      { id: seed.tenantB.id, slug: 'alpha' },
    ])
  })

  it('allows only one winner when two tenants concurrently claim the same slug', async () => {
    await grantGold(seed.tenantA, seed.userA)
    await grantGold(seed.tenantB, seed.userB)

    const responses = await Promise.all([
      patchSlug(seed.userA.id, seed.tenantA.id, 'shared-stage'),
      patchSlug(seed.userB.id, seed.tenantB.id, 'shared-stage'),
    ])
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409])
    expect((await pool.query("SELECT 1 FROM tenants WHERE slug = 'shared-stage'")).rowCount).toBe(1)
  })
})
