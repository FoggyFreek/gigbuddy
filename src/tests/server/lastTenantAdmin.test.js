import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

// A tenant must always keep at least one approved tenant_admin. The rule has to
// hold on EVERY path that can take the last one away — self-removal, admin
// removal and demotion — and it binds super admins too, since an adminless
// tenant is the same broken end state however it was reached.

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

afterAll(async () => pool.end())

const as = (userId, tenantId) => (req) => req
  .set('x-test-user-id', String(userId))
  .set('x-test-tenant-id', String(tenantId))

const asUserA = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asSuper = (req) => as(seed.superUser.id, seed.tenantA.id)(req)

// The seed makes both userA and superUser tenant_admins of tenantA. Demote the
// other one so the named user is the tenant's only remaining admin.
async function makeSoleAdmin(userId) {
  await pool.query(
    `UPDATE memberships SET role = 'reader'
      WHERE tenant_id = $1 AND user_id <> $2 AND role = 'tenant_admin'`,
    [seed.tenantA.id, userId],
  )
}

const countAdmins = async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM memberships
      WHERE tenant_id = $1 AND role = 'tenant_admin' AND status = 'approved'`,
    [seed.tenantA.id],
  )
  return rows[0].n
}

describe('the last tenant_admin cannot be removed', () => {
  it('refuses a tenant admin removing their OWN membership', async () => {
    await makeSoleAdmin(seed.userA.id)

    const res = await asUserA(request(app).delete(`/api/users/${seed.userA.id}`)).expect(409)

    expect(res.body.code).toBe('last_tenant_admin')
    expect(await countAdmins()).toBe(1)
  })

  it('refuses a super admin removing the last admin', async () => {
    await makeSoleAdmin(seed.superUser.id)

    await asSuper(request(app).delete(`/api/users/${seed.superUser.id}`)).expect(409)

    expect(await countAdmins()).toBe(1)
  })

  it('allows self-removal while another admin remains', async () => {
    expect(await countAdmins()).toBe(2)

    await asUserA(request(app).delete(`/api/users/${seed.userA.id}`)).expect(204)

    expect(await countAdmins()).toBe(1)
  })
})

describe('the last tenant_admin cannot be demoted', () => {
  it('refuses demoting the only admin, even for a super admin', async () => {
    await makeSoleAdmin(seed.superUser.id)

    const res = await asSuper(
      request(app).patch(`/api/users/${seed.superUser.id}/membership`).send({ role: 'reader' }),
    ).expect(409)

    expect(res.body.code).toBe('last_tenant_admin')
    expect(await countAdmins()).toBe(1)
  })

  it('allows demoting an admin while another remains', async () => {
    await asSuper(
      request(app).patch(`/api/users/${seed.userA.id}/membership`).send({ role: 'reader' }),
    ).expect(200)

    expect(await countAdmins()).toBe(1)
  })

  it('refuses revoking the only admin by rejecting their membership', async () => {
    await makeSoleAdmin(seed.superUser.id)

    await asSuper(
      request(app).patch(`/api/users/${seed.superUser.id}/membership`).send({ status: 'rejected' }),
    ).expect(409)

    expect(await countAdmins()).toBe(1)
  })
})
