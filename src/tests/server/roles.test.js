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

// Creates an approved user with `role` in `tenantId`, optionally linking a fresh
// band member (returns its id) for self-scope tests.
async function createRoleUser({ email, role, tenantId, link = false }) {
  const { rows: u } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, `Role ${role}`],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, $2, $3, 'approved', NOW())`,
    [u[0].id, tenantId, role],
  )
  let bandMemberId = null
  if (link) {
    const { rows: bm } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
       VALUES ($1, $2, 'lead', 5, $3) RETURNING id`,
      [tenantId, `bm-${email}`, u[0].id],
    )
    bandMemberId = bm[0].id
  }
  return { user: u[0], bandMemberId }
}

const purchasePayload = (overrides = {}) => ({
  supplier_name: 'Studio X',
  receipt_date: '2026-05-01',
  lines: [{ description: 'Recording', expense_category: 'Equipment', tax_rate: 21, amount_incl_cents: 12100 }],
  ...overrides,
})

describe('finance.view gating', () => {
  for (const role of ['reader', 'contributor']) {
    it(`${role} is blocked (403) from finance reads`, async () => {
      const { user } = await createRoleUser({ email: `${role}@a.local`, role, tenantId: seed.tenantA.id })
      const a = as(user.id, seed.tenantA.id)
      await a(request(app).get('/api/invoices')).expect(403)
      await a(request(app).get('/api/journal')).expect(403)
      await a(request(app).get('/api/ledger')).expect(403)
      await a(request(app).get('/api/purchases')).expect(403)
    })
  }

  it('financial_admin can read finance (200)', async () => {
    const { user } = await createRoleUser({ email: 'fa@a.local', role: 'financial_admin', tenantId: seed.tenantA.id })
    const a = as(user.id, seed.tenantA.id)
    await a(request(app).get('/api/invoices')).expect(200)
    await a(request(app).get('/api/journal')).expect(200)
    await a(request(app).get('/api/purchases')).expect(200)
  })
})

describe('purchase.create split', () => {
  it('contributor can create a purchase and see only their own', async () => {
    const { user } = await createRoleUser({ email: 'c@a.local', role: 'contributor', tenantId: seed.tenantA.id })
    const a = as(user.id, seed.tenantA.id)
    await a(request(app).post('/api/purchases').send(purchasePayload())).expect(201)
    const mine = await a(request(app).get('/api/purchases/mine')).expect(200)
    expect(mine.body).toHaveLength(1)
    // The full register stays finance-gated.
    await a(request(app).get('/api/purchases')).expect(403)
  })

  it('reader cannot create a purchase (403)', async () => {
    const { user } = await createRoleUser({ email: 'r@a.local', role: 'reader', tenantId: seed.tenantA.id })
    await as(user.id, seed.tenantA.id)(request(app).post('/api/purchases').send(purchasePayload())).expect(403)
  })

  it('a contributor cannot see another contributor’s purchases via /mine', async () => {
    const c1 = await createRoleUser({ email: 'c1@a.local', role: 'contributor', tenantId: seed.tenantA.id })
    const c2 = await createRoleUser({ email: 'c2@a.local', role: 'contributor', tenantId: seed.tenantA.id })
    await as(c1.user.id, seed.tenantA.id)(request(app).post('/api/purchases').send(purchasePayload())).expect(201)
    const mine = await as(c2.user.id, seed.tenantA.id)(request(app).get('/api/purchases/mine')).expect(200)
    expect(mine.body).toHaveLength(0)
  })
})

describe('planning.write gating', () => {
  const gigBody = { event_date: '2026-09-01', event_description: 'New gig' }

  it('reader can view but not create planning resources', async () => {
    const { user } = await createRoleUser({ email: 'r2@a.local', role: 'reader', tenantId: seed.tenantA.id })
    const a = as(user.id, seed.tenantA.id)
    await a(request(app).get('/api/gigs')).expect(200)
    await a(request(app).post('/api/gigs').send(gigBody)).expect(403)
    await a(request(app).post('/api/songs').send({ title: 'X' })).expect(403)
  })

  it('contributor can create planning resources (201)', async () => {
    const { user } = await createRoleUser({ email: 'c3@a.local', role: 'contributor', tenantId: seed.tenantA.id })
    await as(user.id, seed.tenantA.id)(request(app).post('/api/gigs').send(gigBody)).expect(201)
  })
})

describe('membership role-assignment authority', () => {
  it('tenant admin may assign the new roles but not tenant_admin', async () => {
    const target = await createRoleUser({ email: 'target@a.local', role: 'reader', tenantId: seed.tenantA.id })
    const a = as(seed.userA.id, seed.tenantA.id) // userA is tenant_admin in A
    const ok = await a(request(app).patch(`/api/users/${target.user.id}/membership`).send({ role: 'financial_admin' })).expect(200)
    expect(ok.body.role).toBe('financial_admin')
    await a(request(app).patch(`/api/users/${target.user.id}/membership`).send({ role: 'tenant_admin' })).expect(403)
  })

  it('super admin may assign tenant_admin', async () => {
    const target = await createRoleUser({ email: 'target2@a.local', role: 'contributor', tenantId: seed.tenantA.id })
    const res = await as(seed.superUser.id, seed.tenantA.id)(
      request(app).patch(`/api/users/${target.user.id}/membership`).send({ role: 'tenant_admin' }),
    ).expect(200)
    expect(res.body.role).toBe('tenant_admin')
  })
})

describe('reader self-scope', () => {
  it('reader may toggle done on their own task only', async () => {
    const reader = await createRoleUser({ email: 'r3@a.local', role: 'reader', tenantId: seed.tenantA.id, link: true })
    const a = as(reader.user.id, seed.tenantA.id)
    const { rows: own } = await pool.query(
      `INSERT INTO gig_tasks (tenant_id, gig_id, title, assigned_to) VALUES ($1,$2,'Mine',$3) RETURNING id`,
      [seed.tenantA.id, seed.gigA.id, reader.bandMemberId],
    )
    const { rows: foreign } = await pool.query(
      `INSERT INTO gig_tasks (tenant_id, gig_id, title) VALUES ($1,$2,'Theirs') RETURNING id`,
      [seed.tenantA.id, seed.gigA.id],
    )
    await a(request(app).patch(`/api/gigs/${seed.gigA.id}/tasks/${own[0].id}`).send({ done: true })).expect(200)
    // Non-done field on own task → 403
    await a(request(app).patch(`/api/gigs/${seed.gigA.id}/tasks/${own[0].id}`).send({ title: 'Hacked' })).expect(403)
    // Someone else's task → 403
    await a(request(app).patch(`/api/gigs/${seed.gigA.id}/tasks/${foreign[0].id}`).send({ done: true })).expect(403)
  })

  it('reader may vote only on their own rehearsal participation', async () => {
    const reader = await createRoleUser({ email: 'r4@a.local', role: 'reader', tenantId: seed.tenantA.id, link: true })
    const a = as(reader.user.id, seed.tenantA.id)
    await pool.query(
      `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id) VALUES ($1,$2,$3)`,
      [seed.tenantA.id, seed.rehearsalA.id, reader.bandMemberId],
    )
    await a(request(app).patch(`/api/rehearsals/${seed.rehearsalA.id}/participants/${reader.bandMemberId}`).send({ vote: 'yes' })).expect(200)
    // Voting for the seed band member (not the reader) → 403
    await a(request(app).patch(`/api/rehearsals/${seed.rehearsalA.id}/participants/${seed.memberA.id}`).send({ vote: 'no' })).expect(403)
  })
})

describe('tenant isolation holds for new roles', () => {
  it('financial_admin in tenant A cannot read tenant B purchases (404)', async () => {
    const fa = await createRoleUser({ email: 'fa2@a.local', role: 'financial_admin', tenantId: seed.tenantA.id })
    // userB (tenant_admin in B) creates a purchase in tenant B
    const created = await as(seed.userB.id, seed.tenantB.id)(
      request(app).post('/api/purchases').send(purchasePayload({ supplier_name: 'Beta Supplier' })),
    ).expect(201)
    await as(fa.user.id, seed.tenantA.id)(request(app).get(`/api/purchases/${created.body.id}`)).expect(404)
  })
})
