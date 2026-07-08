import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
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

const asAdminA = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asAdminB = (req) => as(seed.userB.id, seed.tenantB.id)(req)
const asSuper = (req, tenantId = seed.tenantA.id) => as(seed.superUser.id, tenantId)(req)

async function createOutsider({ email = 'outside@test.local', name = 'Outside', status = 'approved' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, $4, false)
     RETURNING *`,
    [`sub-${email}`, email, name, status],
  )
  return rows[0]
}

describe('/api/invites — admin endpoints', () => {
  it('POST / creates a contributor invite for the active tenant', async () => {
    const res = await asAdminA(
      request(app).post('/api/invites').send({ role: 'contributor', expiresInDays: 7 }),
    ).expect(201)
    expect(res.body.role).toBe('contributor')
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(res.body.url).toContain('/redeem-invite?code=')
    expect(res.body.expires_at).toBeTruthy()

    const { rows } = await pool.query(
      'SELECT * FROM tenant_invites WHERE code = $1',
      [res.body.code],
    )
    expect(rows[0].tenant_id).toBe(seed.tenantA.id)
    expect(rows[0].created_by_user_id).toBe(seed.userA.id)
  })

  it('POST / rejects tenant_admin role from non-super tenant_admin', async () => {
    await asAdminA(
      request(app).post('/api/invites').send({ role: 'tenant_admin' }),
    ).expect(403)
  })

  it('POST / lets super admin issue tenant_admin invite', async () => {
    const res = await asSuper(
      request(app).post('/api/invites').send({ role: 'tenant_admin' }),
    ).expect(201)
    expect(res.body.role).toBe('tenant_admin')
  })

  it('POST / rejects invalid role and out-of-range expiry', async () => {
    await asAdminA(request(app).post('/api/invites').send({ role: 'guest' })).expect(400)
    await asAdminA(
      request(app).post('/api/invites').send({ expiresInDays: 0 }),
    ).expect(400)
    await asAdminA(
      request(app).post('/api/invites').send({ expiresInDays: 1000 }),
    ).expect(400)
  })

  it('GET / lists invites only for the active tenant', async () => {
    const a = await asAdminA(request(app).post('/api/invites').send({})).expect(201)
    const b = await asAdminB(request(app).post('/api/invites').send({})).expect(201)

    const res = await asAdminA(request(app).get('/api/invites')).expect(200)
    expect(res.body.map((r) => r.id)).toEqual([a.body.id])
    expect(res.body.find((r) => r.id === b.body.id)).toBeUndefined()
  })

  it('DELETE /:id revokes an invite from the active tenant', async () => {
    const created = await asAdminA(request(app).post('/api/invites').send({})).expect(201)
    await asAdminA(request(app).delete(`/api/invites/${created.body.id}`)).expect(204)

    const { rows } = await pool.query(
      'SELECT expires_at FROM tenant_invites WHERE id = $1',
      [created.body.id],
    )
    expect(rows[0].expires_at).toBeTruthy()
    expect(new Date(rows[0].expires_at).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('DELETE /:id 404s for invites in another tenant', async () => {
    const created = await asAdminB(request(app).post('/api/invites').send({})).expect(201)
    await asAdminA(request(app).delete(`/api/invites/${created.body.id}`)).expect(404)
  })

  it('non-tenant-admin members are forbidden from /api/invites', async () => {
    // Demote userA to plain member.
    await pool.query(
      `UPDATE memberships SET role = 'member' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await asAdminA(request(app).get('/api/invites')).expect(403)
  })
})

describe('/api/invites/redeem', () => {
  async function newInvite(tenantId, role = 'contributor', expiresAt = null) {
    const { rows } = await pool.query(
      `INSERT INTO tenant_invites (code, tenant_id, role, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [`code-${Math.random().toString(36).slice(2)}`, tenantId, role, seed.userA.id, expiresAt],
    )
    return rows[0]
  }

  it('creates a pending membership for an authenticated outsider', async () => {
    const outsider = await createOutsider()
    const invite = await newInvite(seed.tenantA.id)
    const res = await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(201)

    expect(res.body.tenant.id).toBe(seed.tenantA.id)
    expect(res.body.status).toBe('pending')

    const { rows } = await pool.query(
      `SELECT status, role FROM memberships WHERE user_id = $1 AND tenant_id = $2`,
      [outsider.id, seed.tenantA.id],
    )
    expect(rows[0].status).toBe('pending')
    expect(rows[0].role).toBe('contributor')

    const { rows: inviteRows } = await pool.query(
      'SELECT used_at, used_by_user_id FROM tenant_invites WHERE id = $1',
      [invite.id],
    )
    expect(inviteRows[0].used_at).toBeTruthy()
    expect(inviteRows[0].used_by_user_id).toBe(outsider.id)
  })

  it('respects the role on the invite', async () => {
    const outsider = await createOutsider()
    const invite = await newInvite(seed.tenantA.id, 'tenant_admin')
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2`,
      [outsider.id, seed.tenantA.id],
    )
    expect(rows[0].role).toBe('tenant_admin')
  })

  it('re-redeeming by the same user returns the membership instead of a conflict', async () => {
    const outsider = await createOutsider()
    const invite = await newInvite(seed.tenantA.id)
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(201)

    const res = await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(200)
    expect(res.body.tenant.id).toBe(seed.tenantA.id)
    expect(res.body.status).toBe('pending')

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [outsider.id, seed.tenantA.id],
    )
    expect(rows[0].n).toBe(1)

    // Admins are notified once, on the original redemption only.
    const { rows: notif } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'invite-redeemed' AND user_id = $1`,
      [seed.userA.id],
    )
    expect(notif[0].n).toBe(1)
  })

  it('rejects already-used invites', async () => {
    const outsider1 = await createOutsider({ email: 'one@test.local' })
    const outsider2 = await createOutsider({ email: 'two@test.local' })
    const invite = await newInvite(seed.tenantA.id)
    await as(outsider1.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(201)
    await as(outsider2.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(409)
  })

  it('rejects expired invites', async () => {
    const outsider = await createOutsider()
    const past = new Date(Date.now() - 1000)
    const invite = await newInvite(seed.tenantA.id, 'member', past)
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(410)
  })

  it('404s for unknown codes', async () => {
    const outsider = await createOutsider()
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: 'no-such-code' }),
    ).expect(404)
  })

  it('400s when code is missing', async () => {
    const outsider = await createOutsider()
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({}),
    ).expect(400)
  })

  it('rejects redemption from a globally rejected user', async () => {
    const outsider = await createOutsider({ email: 'banned@test.local', status: 'rejected' })
    const invite = await newInvite(seed.tenantA.id)
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(403)
  })

  it('409s if user is already a member of the tenant', async () => {
    // userA is already an approved member of tenantA. Use tenantA invite.
    const invite = await newInvite(seed.tenantA.id)
    await as(seed.userA.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(409)
  })

  it('notifies tenant admins that the redeemed invite awaits approval', async () => {
    // A plain contributor in tenant A must NOT be notified (no members.manage).
    const contrib = await createOutsider({ email: 'contrib@test.local', name: 'Contrib' })
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
       VALUES ($1, $2, 'contributor', 'approved', NOW())`,
      [contrib.id, seed.tenantA.id],
    )

    const outsider = await createOutsider()
    const invite = await newInvite(seed.tenantA.id)
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(201)

    const rowsFor = async (userId) => {
      const { rows } = await pool.query(
        `SELECT * FROM notifications WHERE user_id = $1 AND type = 'invite-redeemed'`,
        [userId],
      )
      return rows
    }

    // Dispatch runs after the response is sent, so poll for the rows.
    await vi.waitFor(async () => {
      expect(await rowsFor(seed.userA.id)).toHaveLength(1)
      expect(await rowsFor(seed.superUser.id)).toHaveLength(1)
    })
    const [row] = await rowsFor(seed.userA.id)
    expect(row).toMatchObject({
      tenant_id: seed.tenantA.id,
      type: 'invite-redeemed',
      url: '/settings/members',
      source_type: 'invite',
      source_id: invite.id,
    })
    expect(row.body).toContain('Outside')

    expect(await rowsFor(contrib.id)).toHaveLength(0)   // not an admin
    expect(await rowsFor(seed.userB.id)).toHaveLength(0) // other tenant
    expect(await rowsFor(outsider.id)).toHaveLength(0)   // the redeemer
  })

  it('does not notify on a failed redemption', async () => {
    const outsider = await createOutsider()
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: 'no-such-code' }),
    ).expect(404)

    // Give any (wrongly) fired dispatch a beat to land before asserting.
    await new Promise((r) => setTimeout(r, 50))
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE type = 'invite-redeemed'`,
    )
    expect(rows).toHaveLength(0)
  })

  it('409s and aborts when the tenant is archived', async () => {
    await pool.query(`UPDATE tenants SET archived_at = NOW() WHERE id = $1`, [seed.tenantA.id])
    const outsider = await createOutsider()
    const invite = await newInvite(seed.tenantA.id)
    await as(outsider.id, null)(
      request(app).post('/api/invites/redeem').send({ code: invite.code }),
    ).expect(409)
    // Membership should not have been created; invite should be rolled back to unused.
    const { rows: m } = await pool.query(
      `SELECT * FROM memberships WHERE user_id = $1 AND tenant_id = $2`,
      [outsider.id, seed.tenantA.id],
    )
    expect(m).toHaveLength(0)
    const { rows: inv } = await pool.query(
      `SELECT used_at FROM tenant_invites WHERE id = $1`,
      [invite.id],
    )
    expect(inv[0].used_at).toBeNull()
  })
})
