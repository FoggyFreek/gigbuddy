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
const asSuper = (req) =>
  req
    .set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))

// Gold subscription with a members-limit override, owned by userA on tenantA.
async function ownWithMemberLimit(members) {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
  return billing.createSubscription({
    userId: seed.userA.id,
    planSlug: 'gold',
    entitlement_overrides: { limits: { members } },
  })
}

async function createPendingUser(email, tenantId) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, 'Pending', 'approved', false) RETURNING *`,
    [`sub-${email}`, email],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status)
     VALUES ($1, $2, 'contributor', 'pending')`,
    [user.id, tenantId],
  )
  return user
}

describe('roster member cap (band_members insert)', () => {
  it('blocks adding a roster member beyond the limit', async () => {
    // Seed already has 1 roster member in tenantA.
    await ownWithMemberLimit(1)
    const res = await asUserA(request(app).post('/api/band-members').send({ name: 'Second' })).expect(409)
    expect(res.body.code).toBe('member_limit_reached')
    expect(res.body.limit).toBe(1)
  })

  it('allows adds under the limit and on unlimited plans', async () => {
    await ownWithMemberLimit(5)
    await asUserA(request(app).post('/api/band-members').send({ name: 'Second' })).expect(201)

    await pool.query('DELETE FROM subscriptions')
    clearEntitlementCaches()
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' }) // members: null
    await asUserA(request(app).post('/api/band-members').send({ name: 'Third' })).expect(201)
  })

  it('ownerless tenants are never capped', async () => {
    await asUserA(request(app).post('/api/band-members').send({ name: 'Anyone' })).expect(201)
  })
})

describe('membership approval cap', () => {
  it('blocks approving a membership beyond the limit', async () => {
    // tenantA seed: userA + superUser hold approved memberships (2).
    await ownWithMemberLimit(2)
    const pending = await createPendingUser('pending1@test.local', seed.tenantA.id)
    const res = await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ status: 'approved' }),
    ).expect(409)
    expect(res.body.code).toBe('member_limit_reached')

    // The membership stays pending.
    const { rows: [m] } = await pool.query(
      'SELECT status FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [pending.id, seed.tenantA.id],
    )
    expect(m.status).toBe('pending')
  })

  it('approves under the limit; re-approving an approved member is not capped', async () => {
    await ownWithMemberLimit(3)
    const pending = await createPendingUser('pending2@test.local', seed.tenantA.id)
    await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ status: 'approved' }),
    ).expect(200)
    // Now at 3/3 — a role change on an approved member must still work.
    await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ role: 'reader' }),
    ).expect(200)
  })

  it('a pending-downgrade snapshot binds approvals immediately', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.createSubscription({
      userId: seed.userA.id,
      planSlug: 'gold',
      pending_limits_snapshot: { members: 2 },
    })
    const pending = await createPendingUser('pending3@test.local', seed.tenantA.id)
    const res = await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ status: 'approved' }),
    ).expect(409)
    expect(res.body.code).toBe('member_limit_reached')
  })
})

describe('super-admin direct grants respect the cap', () => {
  it('blocks a direct membership grant beyond the limit', async () => {
    await ownWithMemberLimit(2)
    const outsider = await createPendingUser('outsider@test.local', seed.tenantB.id)
    const res = await asSuper(
      request(app).post(`/api/admin/tenants/${seed.tenantA.id}/memberships`).send({ userId: outsider.id }),
    ).expect(409)
    expect(res.body.code).toBe('member_limit_reached')
  })

  it('promoting an existing approved member consumes no capacity', async () => {
    await ownWithMemberLimit(2)
    // userA is already approved — granting admin re-upserts, no new capacity.
    await asSuper(
      request(app).post(`/api/admin/tenants/${seed.tenantA.id}/admins`).send({ userId: seed.userA.id }),
    ).expect(201)
  })
})
