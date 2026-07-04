import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearEntitlementCaches
let billing
let seed

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
  billing = await import('./_billing.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
})

afterAll(async () => {
  await pool.end()
})

const asUserA = (req) =>
  req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) =>
  req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
const asSuper = (req) =>
  req
    .set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))

function createBody(slug = 'my-band') {
  return { slug, band_name: 'My Band' }
}

describe('POST /api/tenants (self-service creation)', () => {
  it('creates an owned, seeded tenant with the creator as tenant_admin', async () => {
    const res = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    expect(res.body.owner_user_id).toBe(seed.userA.id)
    expect(res.body.slug).toBe('my-band')

    const { rows: [membership] } = await pool.query(
      'SELECT role, status FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, res.body.id],
    )
    expect(membership).toEqual({ role: 'tenant_admin', status: 'approved' })

    const { rows: [accounts] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chart_of_accounts WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(accounts.count).toBeGreaterThan(0)

    const { rows: [stats] } = await pool.query(
      'SELECT 1 FROM tenant_statistics WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(stats).toBeTruthy()
  })

  it('validates slug and band_name', async () => {
    await asUserA(request(app).post('/api/tenants').send({ slug: 'Bad Slug!', band_name: 'X' })).expect(400)
    await asUserA(request(app).post('/api/tenants').send({ slug: 'ok-slug' })).expect(400)
  })

  it('409s on a duplicate slug', async () => {
    await asUserA(request(app).post('/api/tenants').send(createBody('alpha'))).expect(409)
  })

  it('enforces the band cap (no subscription → fallback bronze: 1 band)', async () => {
    await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
    expect(res.body.limit).toBe(1)
  })

  it('gold owners create unlimited bands', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    for (const slug of ['band-one', 'band-two', 'band-three']) {
      await asUserA(request(app).post('/api/tenants').send(createBody(slug))).expect(201)
    }
  })

  it('a pending-downgrade snapshot binds the band cap immediately', async () => {
    await billing.createSubscription({
      userId: seed.userA.id,
      planSlug: 'gold',
      pending_limits_snapshot: { bands: 1 },
    })
    await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
  })

  it('archived tenants do not count toward the cap', async () => {
    const first = await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    await asUserA(request(app).post(`/api/tenants/${first.body.id}/archive`)).expect(200)
    await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(201)
  })
})

describe('GET /api/tenants/owned', () => {
  it('lists only the tenants the caller owns', async () => {
    const created = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    const res = await asUserA(request(app).get('/api/tenants/owned')).expect(200)
    expect(res.body.map((t) => t.id)).toEqual([created.body.id])
    const other = await asUserB(request(app).get('/api/tenants/owned')).expect(200)
    expect(other.body).toEqual([])
  })
})

describe('archive / unarchive', () => {
  let ownedId

  beforeEach(async () => {
    const res = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    ownedId = res.body.id
  })

  it('owner can archive and unarchive', async () => {
    const archived = await asUserA(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(200)
    expect(archived.body.archived_at).not.toBeNull()
    const restored = await asUserA(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(200)
    expect(restored.body.archived_at).toBeNull()
  })

  it('non-owners get 404, not 403 (existence is not leaked)', async () => {
    await asUserB(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(404)
    await asUserB(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(404)
    // Even a super admin uses the admin endpoints, not the owner ones.
    await asSuper(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(404)
  })

  it('unarchive re-checks the band cap (archiving is not a parking loophole)', async () => {
    // Bronze fallback: 1 active band. Park the first, create a second.
    await asUserA(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(200)
    await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(201)
    // Swapping the first back in would make 2 active → 409.
    const res = await asUserA(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
  })
})

describe('admin owner assignment (PATCH /api/admin/tenants/:id)', () => {
  it('assigns and detaches an owner', async () => {
    const res = await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: seed.userA.id }),
    ).expect(200)
    expect(res.body.owner_user_id).toBe(seed.userA.id)

    const detached = await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: null }),
    ).expect(200)
    expect(detached.body.owner_user_id).toBeNull()
  })

  it('rejects invalid owners', async () => {
    await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: 999999 }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: 'abc' }),
    ).expect(400)
  })

  it('is super-admin only', async () => {
    await asUserA(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: seed.userA.id }),
    ).expect(403)
  })
})
