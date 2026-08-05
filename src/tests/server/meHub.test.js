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

// The cross-tenant agenda needs no active tenant, so requests deliberately send
// `x-test-tenant-id: null` — proving the reads never depend on one.
const asUser = (userId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', 'null')

async function createUser(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, email.split('@')[0]],
  )
  return rows[0]
}

async function addMembership(userId, tenantId, { role = 'contributor', status = 'approved' } = {}) {
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'approved' THEN NOW() END, 'admin')`,
    [userId, tenantId, role, status],
  )
  if (status === 'approved') {
    await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
       SELECT $2, u.name, 'lead', 100, u.id
         FROM users u JOIN tenants t ON t.id = $2
        WHERE u.id = $1 AND t.kind = 'band'
       ON CONFLICT (user_id, tenant_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [userId, tenantId],
    )
  }
}

async function addGig(tenantId, { date, name = 'Show', status = 'confirmed' }) {
  const { rows } = await pool.query(
    `INSERT INTO gigs (tenant_id, event_description, event_date, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, name, date, status],
  )
  const gig = rows[0]
  await pool.query(
    `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
     SELECT $1, $2, id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId, gig.id],
  )
  return gig
}

// A rehearsal's human label is its location — there is no title column.
async function addRehearsal(tenantId, { date, title = 'Rehearsal' }) {
  const { rows } = await pool.query(
    `INSERT INTO rehearsals (tenant_id, location, proposed_date) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, title, date],
  )
  const rehearsal = rows[0]
  await pool.query(
    `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id, vote)
     SELECT $1, $2, id, 'yes' FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId, rehearsal.id],
  )
  return rehearsal
}

async function addBandEvent(tenantId, { start, end, title = 'Event' }) {
  const { rows } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, title, start, end],
  )
  const event = rows[0]
  await pool.query(
    `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
     SELECT $1, $2, id FROM band_members WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId, event.id],
  )
  return event
}

const WINDOW = { from: '2099-07-01', to: '2099-07-31' }
const agenda = (userId, q = WINDOW) =>
  asUser(userId)(request(app).get('/api/me/agenda').query(q))

describe('GET /api/me/agenda', () => {
  it('merges gigs, rehearsals and events where the artist is required, in date order', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)

    await addGig(seed.tenantA.id, { date: '2099-07-10', name: 'A Show' })
    await addRehearsal(seed.tenantB.id, { date: '2099-07-05', title: 'B Rehearsal' })
    await addBandEvent(seed.tenantA.id, { start: '2099-07-20', end: '2099-07-21', title: 'A Event' })

    const res = await agenda(artist.id).expect(200)
    expect(res.body.items.map((i) => [i.date, i.type, i.title])).toEqual([
      ['2099-07-05', 'rehearsal', 'B Rehearsal'],
      ['2099-07-10', 'gig', 'A Show'],
      ['2099-07-20', 'band_event', 'A Event'],
    ])
    expect(res.body.meta).toMatchObject({ from: WINDOW.from, to: WINDOW.to, returned: 3 })
  })

  it('omits a band event when the artist is a member but not a required participant', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    const event = await addBandEvent(seed.tenantA.id, {
      start: '2099-07-20', end: '2099-07-20', title: 'Not required',
    })
    const { rows: [member] } = await pool.query(
      'SELECT id FROM band_members WHERE tenant_id = $1 AND user_id = $2',
      [seed.tenantA.id, artist.id],
    )
    await pool.query(
      `DELETE FROM band_event_participants
        WHERE tenant_id = $1 AND band_event_id = $2 AND band_member_id = $3`,
      [seed.tenantA.id, event.id, member.id],
    )

    expect((await agenda(artist.id).expect(200)).body.items).toEqual([])
  })

  it('includes the artist\'s own personal-workspace event without a participant row', async () => {
    const { rows: [workspace] } = await pool.query(
      `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
       VALUES ('artist-agenda', 'Alpha Artist', 'Alpha Artist', 'personal', $1, $1) RETURNING *`,
      [seed.userA.id],
    )
    await addMembership(seed.userA.id, workspace.id, { role: 'tenant_admin' })
    await addBandEvent(workspace.id, {
      start: '2099-07-22', end: '2099-07-23', title: 'Artist appointment',
    })

    const res = await agenda(seed.userA.id).expect(200)
    expect(res.body.items).toContainEqual(expect.objectContaining({
      type: 'band_event',
      title: 'Artist appointment',
      description: 'Artist appointment — Alpha Artist',
      tenantId: workspace.id,
      tenantName: 'Alpha Artist',
      endDate: '2099-07-23',
    }))
  })

  it('labels every item with the band it belongs to', async () => {
    await addGig(seed.tenantA.id, { date: '2099-07-10' })
    const res = await agenda(seed.userA.id).expect(200)
    expect(res.body.items[0]).toMatchObject({
      tenantId: seed.tenantA.id,
      tenantName: 'Alpha Band',
      kind: 'band',
    })
  })

  // The core isolation guarantee: rows from a tenant the caller isn't an
  // approved member of are ABSENT, never present-and-blanked.
  it('never returns rows from a tenant the caller is not an approved member of', async () => {
    await addGig(seed.tenantB.id, { date: '2099-07-10', name: 'B Show' })
    const res = await agenda(seed.userA.id).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('drops a tenant\'s rows while the membership is only pending', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { status: 'pending' })
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-10' })

    const pendingRes = await agenda(artist.id).expect(200)
    expect(pendingRes.body.items).toEqual([])

    await pool.query(
      `UPDATE memberships SET status = 'approved', approved_at = NOW()
        WHERE user_id = $1 AND tenant_id = $2`,
      [artist.id, seed.tenantA.id],
    )
    const { rows: [member] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
       VALUES ($1, 'Artist', 'lead', 100, $2) RETURNING *`,
      [seed.tenantA.id, artist.id],
    )
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
       VALUES ($1, $2, $3)`,
      [seed.tenantA.id, gig.id, member.id],
    )
    const approvedRes = await agenda(artist.id).expect(200)
    expect(approvedRes.body.items).toHaveLength(1)
  })

  it('drops the rows again the moment a membership is revoked', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addGig(seed.tenantA.id, { date: '2099-07-10' })
    expect((await agenda(artist.id).expect(200)).body.items).toHaveLength(1)

    await pool.query('DELETE FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [artist.id, seed.tenantA.id])
    expect((await agenda(artist.id).expect(200)).body.items).toEqual([])
  })

  it('drops an archived tenant\'s rows', async () => {
    await addGig(seed.tenantA.id, { date: '2099-07-10' })
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    expect((await agenda(seed.userA.id).expect(200)).body.items).toEqual([])
  })

  // Invariant 2: the client never names the tenants it wants.
  it('ignores a tenant id supplied by the client in the query or the body', async () => {
    await addGig(seed.tenantB.id, { date: '2099-07-10', name: 'B Show' })

    const viaQuery = await asUser(seed.userA.id)(
      request(app).get('/api/me/agenda').query({ ...WINDOW, tenantId: seed.tenantB.id }),
    ).expect(200)
    expect(viaQuery.body.items).toEqual([])

    const viaBody = await asUser(seed.userA.id)(
      request(app).get('/api/me/agenda').query(WINDOW)
        .send({ tenantId: seed.tenantB.id, memberTenantIds: [seed.tenantB.id] }),
    ).expect(200)
    expect(viaBody.body.items).toEqual([])
  })

  it('includes items exactly on both window bounds, and a straddling event', async () => {
    await addGig(seed.tenantA.id, { date: WINDOW.from, name: 'On from' })
    await addGig(seed.tenantA.id, { date: WINDOW.to, name: 'On to' })
    await addBandEvent(seed.tenantA.id, { start: '2099-06-28', end: '2099-07-02', title: 'Straddles' })
    await addGig(seed.tenantA.id, { date: '2099-08-01', name: 'Outside' })

    const res = await agenda(seed.userA.id).expect(200)
    expect(res.body.items.map((i) => i.title).sort()).toEqual(['On from', 'On to', 'Straddles'])
  })

  it('400s on a malformed window rather than scanning unbounded', async () => {
    await asUser(seed.userA.id)(request(app).get('/api/me/agenda')).expect(400)
    await agenda(seed.userA.id, { from: '2099-07-01' }).expect(400)
    await agenda(seed.userA.id, { from: '2099-07-31', to: '2099-07-01' }).expect(400)
    await agenda(seed.userA.id, { from: 'nope', to: '2099-07-31' }).expect(400)
  })

  it('returns an empty window for a user with no memberships', async () => {
    const outsider = await createUser('nobody@test.local')
    const res = await agenda(outsider.id).expect(200)
    expect(res.body).toMatchObject({ items: [], meta: { returned: 0 } })
  })
})

describe('the cross-tenant agenda tier', () => {
  it('rejects unauthenticated callers', async () => {
    await request(app).get('/api/me/agenda').query(WINDOW)
      .set('x-test-user-id', 'null').expect(401)
  })

  // The agenda must never leak a tenant scope into the request: a later handler
  // relying on req.tenantId would silently read the wrong tenant.
  it('does not set an active tenant as a side effect', async () => {
    const { resolveMemberTenantIds } = await import('../../../server/middleware/tenant.js')
    const req = { session: { userId: seed.userA.id }, get: () => undefined, headers: {} }
    await new Promise((resolve, reject) => {
      resolveMemberTenantIds(req, { status: () => ({ json: reject }) }, (err) =>
        err ? reject(err) : resolve())
    })
    expect(req.memberTenants.map((tenant) => tenant.tenantId)).toEqual([seed.tenantA.id])
    expect(req.tenantId).toBeUndefined()
    expect(req.membership).toBeUndefined()
  })
})
