import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants, billing
let seed

beforeAll(async () => {
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
  await billing.createSubscription({ userId: user.id, planSlug: 'gold' })
}

describe('PATCH /api/tenant/slug', () => {
  it('changes only the active band tenant for a Gold tenant admin', async () => {
    await grantGold(seed.tenantA, seed.userA)

    const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live', {
      tenantId: seed.tenantB.id,
    }).expect(200)

    expect(res.body).toEqual({ slug: 'alpha-live' })
    const { rows } = await pool.query('SELECT id, slug FROM tenants ORDER BY id')
    expect(rows).toEqual([
      { id: seed.tenantA.id, slug: 'alpha-live' },
      { id: seed.tenantB.id, slug: 'beta' },
    ])
  })

  it('requires the custom_slug entitlement', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)

    const res = await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live').expect(403)
    expect(res.body).toMatchObject({ code: 'entitlement_required', feature: 'custom_slug' })
  })

  it('requires tenant.manage and rejects personal workspaces', async () => {
    await grantGold(seed.tenantA, seed.userA)
    await pool.query(
      "UPDATE memberships SET role = 'contributor' WHERE tenant_id = $1 AND user_id = $2",
      [seed.tenantA.id, seed.userA.id],
    )
    await patchSlug(seed.userA.id, seed.tenantA.id, 'alpha-live').expect(403)

    const personal = await billing.createPersonalTenant(seed.userA.id)
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
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
