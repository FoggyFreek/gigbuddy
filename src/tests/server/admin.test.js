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

async function createPendingUser({ email, name = 'Pending', tenantId, status = 'pending' }) {
  const { rows: u } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false)
     RETURNING *`,
    [`sub-${email}`, email, name],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status)
     VALUES ($1, $2, 'member', $3)`,
    [u[0].id, tenantId, status],
  )
  return u[0]
}

async function createUser({ email, name = 'User' }) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false)
     RETURNING *`,
    [`sub-${email}`, email, name],
  )
  return rows[0]
}

describe('/api/users — tenant-scoped membership ops', () => {
  it('GET / returns memberships only for the active tenant', async () => {
    await createPendingUser({ email: 'pa@test.local', tenantId: seed.tenantA.id })
    await createPendingUser({ email: 'pb@test.local', tenantId: seed.tenantB.id })

    const res = await asUserA(request(app).get('/api/users')).expect(200)
    const emails = res.body.map((r) => r.email).sort()
    // userA + superUser + new pending A user → 3 rows. No tenantB rows.
    expect(emails).toEqual(['a@test.local', 'pa@test.local', 'su@test.local'])
    expect(res.body.every((r) => r.user_id !== seed.userB.id)).toBe(true)
  })

  it('PATCH /:userId/membership approves a pending member in active tenant only', async () => {
    const pending = await createPendingUser({ email: 'pa@test.local', tenantId: seed.tenantA.id })
    const res = await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ status: 'approved' }),
    ).expect(200)
    expect(res.body.status).toBe('approved')
    expect(res.body.approved_at).toBeTruthy()

    const { rows } = await pool.query(
      'SELECT status, approved_by_user_id FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [pending.id, seed.tenantA.id],
    )
    expect(rows[0].status).toBe('approved')
    expect(rows[0].approved_by_user_id).toBe(seed.userA.id)
  })

  it('PATCH /:userId/membership across tenants → 404', async () => {
    // userB has a membership in tenant B; userA is acting in tenant A
    await asUserA(
      request(app).patch(`/api/users/${seed.userB.id}/membership`).send({ status: 'rejected' }),
    ).expect(404)
  })

  it('tenant_admin cannot grant tenant_admin role', async () => {
    const pending = await createPendingUser({
      email: 'pa@test.local',
      tenantId: seed.tenantA.id,
      status: 'approved',
    })
    await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ role: 'tenant_admin' }),
    ).expect(403)
  })

  it('super admin can grant tenant_admin role', async () => {
    const pending = await createPendingUser({
      email: 'pa@test.local',
      tenantId: seed.tenantA.id,
      status: 'approved',
    })
    const res = await asSuper(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ role: 'tenant_admin' }),
      seed.tenantA.id,
    ).expect(200)
    expect(res.body.role).toBe('tenant_admin')
  })

  it('tenant_admin cannot approve a pending tenant_admin membership', async () => {
    const u = await createUser({ email: 'pending-admin@test.local' })
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES ($1, $2, 'tenant_admin', 'pending')`,
      [u.id, seed.tenantA.id],
    )
    await asUserA(
      request(app).patch(`/api/users/${u.id}/membership`).send({ status: 'approved' }),
    ).expect(403)
    const { rows } = await pool.query(
      'SELECT status FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [u.id, seed.tenantA.id],
    )
    expect(rows[0].status).toBe('pending')
  })

  it('super admin can approve a pending tenant_admin membership', async () => {
    const u = await createUser({ email: 'pending-admin@test.local' })
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES ($1, $2, 'tenant_admin', 'pending')`,
      [u.id, seed.tenantA.id],
    )
    const res = await asSuper(
      request(app).patch(`/api/users/${u.id}/membership`).send({ status: 'approved' }),
      seed.tenantA.id,
    ).expect(200)
    expect(res.body.status).toBe('approved')
    expect(res.body.role).toBe('tenant_admin')
  })

  it('tenant_admin can still approve a pending member-role membership', async () => {
    const pending = await createPendingUser({
      email: 'pm@test.local',
      tenantId: seed.tenantA.id,
    })
    const res = await asUserA(
      request(app).patch(`/api/users/${pending.id}/membership`).send({ status: 'approved' }),
    ).expect(200)
    expect(res.body.status).toBe('approved')
    expect(res.body.role).toBe('member')
  })

  it('tenant_admin cannot remove a super admin membership', async () => {
    await asUserA(request(app).delete(`/api/users/${seed.superUser.id}`)).expect(403)
    const { rows } = await pool.query(
      'SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.superUser.id, seed.tenantA.id],
    )
    expect(rows).toHaveLength(1)
  })

  it('DELETE /:userId removes membership only in active tenant', async () => {
    // Give userA a second membership in tenant B for this test (super admin grants it)
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
       VALUES ($1, $2, 'member', 'approved', NOW())`,
      [seed.userA.id, seed.tenantB.id],
    )
    // Super admin removes userA's membership in tenant B (acting in tenant B)
    await asSuper(request(app).delete(`/api/users/${seed.userA.id}`), seed.tenantB.id).expect(204)

    const { rows: bRows } = await pool.query(
      'SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, seed.tenantB.id],
    )
    expect(bRows).toHaveLength(0)
    const { rows: aRows } = await pool.query(
      'SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, seed.tenantA.id],
    )
    expect(aRows).toHaveLength(1)
  })

  it('PATCH /:userId/band-member links a band_member in active tenant', async () => {
    const pending = await createPendingUser({
      email: 'pa@test.local',
      tenantId: seed.tenantA.id,
      status: 'approved',
    })
    const { rows } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, sort_order) VALUES ($1, 'Free Slot', 1) RETURNING id`,
      [seed.tenantA.id],
    )
    const res = await asUserA(
      request(app)
        .patch(`/api/users/${pending.id}/band-member`)
        .send({ band_member_id: rows[0].id }),
    ).expect(200)
    expect(res.body.band_member_id).toBe(rows[0].id)
  })

  it('PATCH /:userId/band-member rejects a band_member from another tenant', async () => {
    const pending = await createPendingUser({
      email: 'pa@test.local',
      tenantId: seed.tenantA.id,
      status: 'approved',
    })
    await asUserA(
      request(app)
        .patch(`/api/users/${pending.id}/band-member`)
        .send({ band_member_id: seed.memberB.id }),
    ).expect(404)
  })
})

describe('/api/invites/redeem', () => {
  it('claims an invite once before creating membership', async () => {
    const code = 'single-use-code'
    await pool.query(
      `INSERT INTO tenant_invites (code, tenant_id, role, created_by_user_id)
       VALUES ($1, $2, 'member', $3)`,
      [code, seed.tenantA.id, seed.superUser.id],
    )
    const secondUser = await createUser({ email: 'second@test.local' })

    const first = await as(seed.userB.id, null)(
      request(app).post('/api/invites/redeem').send({ code }),
    ).expect(201)
    expect(first.body.tenant.id).toBe(seed.tenantA.id)

    await as(secondUser.id, null)(
      request(app).post('/api/invites/redeem').send({ code }),
    ).expect(409)

    const { rows: memberships } = await pool.query(
      `SELECT user_id, tenant_id, status
         FROM memberships
        WHERE tenant_id = $1 AND user_id IN ($2, $3)
        ORDER BY user_id`,
      [seed.tenantA.id, seed.userB.id, secondUser.id],
    )
    expect(memberships).toEqual([
      { user_id: seed.userB.id, tenant_id: seed.tenantA.id, status: 'pending' },
    ])

    const { rows: invites } = await pool.query(
      'SELECT used_by_user_id FROM tenant_invites WHERE code = $1',
      [code],
    )
    expect(invites[0].used_by_user_id).toBe(seed.userB.id)
  })
})

describe('/api/admin/tenants — super admin only', () => {
  it('GET / requires super admin', async () => {
    await asUserA(request(app).get('/api/admin/tenants')).expect(403)
  })

  it('super admin can list, create, archive, unarchive tenants', async () => {
    const list = await asSuper(request(app).get('/api/admin/tenants')).expect(200)
    expect(list.body).toHaveLength(2)

    const created = await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'gamma', band_name: 'Gamma Band' }),
    ).expect(201)
    expect(created.body.slug).toBe('gamma')
    expect(created.body.archived_at).toBeNull()
    // The creating super admin is auto-added as tenant_admin so the new tenant is usable.
    const { rows: seedAdmin } = await pool.query(
      `SELECT role, status FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [created.body.id, seed.superUser.id],
    )
    expect(seedAdmin[0]).toMatchObject({ role: 'tenant_admin', status: 'approved' })

    const archived = await asSuper(
      request(app).post(`/api/admin/tenants/${created.body.id}/archive`),
    ).expect(200)
    expect(archived.body.archived_at).toBeTruthy()

    const unarchived = await asSuper(
      request(app).post(`/api/admin/tenants/${created.body.id}/unarchive`),
    ).expect(200)
    expect(unarchived.body.archived_at).toBeNull()
  })

  it('rejects invalid slug', async () => {
    await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'Bad Slug!', band_name: 'X' }),
    ).expect(400)
  })

  it('duplicate slug → 409', async () => {
    await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'alpha', band_name: 'Dup' }),
    ).expect(409)
  })

  it('POST /:id/admins assigns tenant_admin to a user (creates approved membership)', async () => {
    const created = await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'gamma', band_name: 'Gamma' }),
    ).expect(201)
    // userA is currently NOT a member of gamma
    const res = await asSuper(
      request(app).post(`/api/admin/tenants/${created.body.id}/admins`).send({ userId: seed.userA.id }),
    ).expect(201)
    expect(res.body.role).toBe('tenant_admin')
    expect(res.body.status).toBe('approved')
    expect(res.body.tenant_id).toBe(created.body.id)
  })

  it('POST / accepts adminUserId to seed a different tenant_admin', async () => {
    const created = await asSuper(
      request(app)
        .post('/api/admin/tenants')
        .send({ slug: 'delta', band_name: 'Delta', adminUserId: seed.userA.id }),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT role, status FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [created.body.id, seed.userA.id],
    )
    expect(rows[0]).toMatchObject({ role: 'tenant_admin', status: 'approved' })
    // super admin was NOT auto-added because adminUserId was explicit
    const { rows: superRows } = await pool.query(
      `SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [created.body.id, seed.superUser.id],
    )
    expect(superRows).toHaveLength(0)
  })

  it('POST / with adminUserId: null skips the seed membership', async () => {
    const created = await asSuper(
      request(app)
        .post('/api/admin/tenants')
        .send({ slug: 'epsilon', band_name: 'Epsilon', adminUserId: null }),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT 1 FROM memberships WHERE tenant_id = $1`,
      [created.body.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('POST /:id/memberships grants a member-role membership directly', async () => {
    const created = await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'zeta', band_name: 'Zeta' }),
    ).expect(201)
    const res = await asSuper(
      request(app)
        .post(`/api/admin/tenants/${created.body.id}/memberships`)
        .send({ userId: seed.userA.id }),
    ).expect(201)
    expect(res.body.role).toBe('member')
    expect(res.body.status).toBe('approved')
    expect(res.body.tenant_id).toBe(created.body.id)
  })

  it('POST /:id/memberships upserts existing membership and can promote role', async () => {
    // userA is already tenant_admin in seed.tenantA. Force role=member.
    const res = await asSuper(
      request(app)
        .post(`/api/admin/tenants/${seed.tenantA.id}/memberships`)
        .send({ userId: seed.userA.id, role: 'member' }),
    ).expect(201)
    expect(res.body.role).toBe('member')
  })

  it('POST /:id/memberships rejects an archived tenant', async () => {
    await pool.query(`UPDATE tenants SET archived_at = NOW() WHERE id = $1`, [seed.tenantA.id])
    await asSuper(
      request(app)
        .post(`/api/admin/tenants/${seed.tenantA.id}/memberships`)
        .send({ userId: seed.userB.id }),
    ).expect(409)
  })

  it('POST /:id/memberships rejects invalid role', async () => {
    await asSuper(
      request(app)
        .post(`/api/admin/tenants/${seed.tenantA.id}/memberships`)
        .send({ userId: seed.userA.id, role: 'guest' }),
    ).expect(400)
  })

  it('DELETE /:id/admins/:userId demotes to member', async () => {
    await asSuper(
      request(app).delete(`/api/admin/tenants/${seed.tenantA.id}/admins/${seed.userA.id}`),
    ).expect(204)
    const { rows } = await pool.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, seed.tenantA.id],
    )
    expect(rows[0].role).toBe('member')
  })
})

describe('/api/admin/users — super admin only', () => {
  it('GET / requires super admin', async () => {
    await asUserA(request(app).get('/api/admin/users')).expect(403)
  })

  it('GET / lists all users with memberships', async () => {
    const res = await asSuper(request(app).get('/api/admin/users')).expect(200)
    expect(res.body).toHaveLength(3)
    const su = res.body.find((u) => u.email === 'su@test.local')
    expect(su.is_super_admin).toBe(true)
    expect(su.memberships).toHaveLength(2)
  })

  it('DELETE /:id hard-deletes a user', async () => {
    await asSuper(request(app).delete(`/api/admin/users/${seed.userB.id}`)).expect(204)
    const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [seed.userB.id])
    expect(rows).toHaveLength(0)
  })

  it('DELETE rejects deleting self', async () => {
    await asSuper(request(app).delete(`/api/admin/users/${seed.superUser.id}`)).expect(400)
  })

  it('DELETE rejects deleting the bootstrap ADMIN_EMAIL user', async () => {
    // Promote userA to ADMIN_EMAIL for this test
    process.env.ADMIN_EMAIL = 'a@test.local'
    await asSuper(request(app).delete(`/api/admin/users/${seed.userA.id}`)).expect(400)
    process.env.ADMIN_EMAIL = 'admin@test.local'
  })
})

describe('Archived tenants', () => {
  async function archiveA() {
    await pool.query(`UPDATE tenants SET archived_at = NOW() WHERE id = $1`, [seed.tenantA.id])
  }

  it('resolveTenantId rejects an existing approved member of an archived tenant', async () => {
    await archiveA()
    await asUserA(request(app).get('/api/gigs')).expect(403)
  })

  it('/auth/me hides archived tenants from memberships and clears active selection if archived', async () => {
    // Give userA a membership in tenant B too so we can verify the active
    // tenant falls back to a non-archived membership when the active one is archived.
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
       VALUES ($1, $2, 'member', 'approved', NOW())`,
      [seed.userA.id, seed.tenantB.id],
    )
    await archiveA()

    const res = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(res.body.memberships.map((m) => m.tenantId)).toEqual([seed.tenantB.id])
    expect(res.body.activeTenantId).toBe(seed.tenantB.id)
  })

  it('/auth/me leaves activeTenantId null when all memberships are in archived tenants', async () => {
    await archiveA()
    const res = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(res.body.memberships).toEqual([])
    expect(res.body.activeTenantId).toBeNull()
  })

  it('/auth/active-tenant rejects switching to an archived tenant', async () => {
    // Make superUser also a member of an archived tenant via the tenants table.
    await archiveA()
    await asSuper(
      request(app).post('/api/auth/active-tenant').send({ tenantId: seed.tenantA.id }),
      seed.tenantB.id,
    ).expect(403)
  })
})
