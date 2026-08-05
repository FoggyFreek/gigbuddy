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

// The hub needs no active tenant, so every request here deliberately sends
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
}

async function addGig(tenantId, { date, name = 'Show', status = 'confirmed' }) {
  const { rows } = await pool.query(
    `INSERT INTO gigs (tenant_id, event_description, event_date, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, name, date, status],
  )
  return rows[0]
}

// A rehearsal's human label is its location — there is no title column.
async function addRehearsal(tenantId, { date, title = 'Rehearsal' }) {
  const { rows } = await pool.query(
    `INSERT INTO rehearsals (tenant_id, location, proposed_date) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, title, date],
  )
  return rows[0]
}

async function addBandEvent(tenantId, { start, end, title = 'Event' }) {
  const { rows } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, title, start, end],
  )
  return rows[0]
}

const WINDOW = { from: '2099-07-01', to: '2099-07-31' }
const agenda = (userId, q = WINDOW) =>
  asUser(userId)(request(app).get('/api/me/agenda').query(q))

describe('GET /api/me/bands', () => {
  it('lists exactly the caller\'s approved, non-archived memberships', async () => {
    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items.map((b) => b.tenantId)).toEqual([seed.tenantA.id])
    expect(res.body.items[0]).toMatchObject({ source: 'tenant', kind: 'band', role: 'tenant_admin' })
  })

  it('is an empty list — not a 403 — for a user with no memberships', async () => {
    const outsider = await createUser('nobody@test.local')
    const res = await asUser(outsider.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('omits pending and rejected memberships', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { status: 'pending' })
    await addMembership(artist.id, seed.tenantB.id, { status: 'rejected' })

    const res = await asUser(artist.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('omits archived tenants', async () => {
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('includes the caller\'s personal workspace alongside their bands', async () => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
       VALUES ('artist-ws', 'Alpha User', 'Alpha User', 'personal', $1, $1) RETURNING *`,
      [seed.userA.id],
    )
    await addMembership(seed.userA.id, ws.id, { role: 'tenant_admin' })

    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    const kinds = Object.fromEntries(res.body.items.map((b) => [b.tenantId, b.kind]))
    expect(kinds).toEqual({ [seed.tenantA.id]: 'band', [ws.id]: 'personal' })
  })
})

describe('GET /api/me/agenda', () => {
  it('merges gigs, rehearsals and events across every member tenant, in date order', async () => {
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
    await addGig(seed.tenantA.id, { date: '2099-07-10' })

    const pendingRes = await agenda(artist.id).expect(200)
    expect(pendingRes.body.items).toEqual([])

    await pool.query(
      `UPDATE memberships SET status = 'approved', approved_at = NOW()
        WHERE user_id = $1 AND tenant_id = $2`,
      [artist.id, seed.tenantA.id],
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

describe('GET /api/me/agenda/past', () => {
  // The fixture seeds a 2026 gig per tenant; every date here is later, so clear
  // them and let each test own the whole feed it asserts on.
  beforeEach(async () => { await pool.query('DELETE FROM gigs') })

  const past = (userId, q = {}) =>
    asUser(userId)(request(app).get('/api/me/agenda/past').query({ today: '2099-01-01', ...q }))

  it('pages back through history across tenants without repeating or skipping', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)

    // Alternate tenants so a per-tenant bug would show up as a gap.
    const expected = []
    for (let i = 1; i <= 7; i++) {
      const tenantId = i % 2 === 0 ? seed.tenantA.id : seed.tenantB.id
      const date = `2098-0${i}-15`
      await addGig(tenantId, { date, name: `Gig ${i}` })
      expected.push(`Gig ${i}`)
    }
    expected.reverse() // most recent first

    const seen = []
    let cursor = null
    for (let page = 0; page < 5; page++) {
      const q = { limit: 3, ...(cursor ? { cursorDate: cursor.date, cursorId: cursor.id } : {}) }
      const res = await past(artist.id, q).expect(200)
      seen.push(...res.body.items.map((i) => i.title))
      cursor = res.body.meta.nextCursor
      if (!cursor) break
    }

    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(seen.length) // no repeats
    expect(cursor).toBeNull() // a short page ends the feed
  })

  it('never pages into a tenant the caller left', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    await addGig(seed.tenantA.id, { date: '2098-01-15', name: 'Kept' })
    await addGig(seed.tenantB.id, { date: '2098-02-15', name: 'Lost' })

    await pool.query('DELETE FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [artist.id, seed.tenantB.id])

    const res = await past(artist.id, { limit: 50 }).expect(200)
    expect(res.body.items.map((i) => i.title)).toEqual(['Kept'])
  })

  it('400s on a malformed cursor or a missing today', async () => {
    await asUser(seed.userA.id)(request(app).get('/api/me/agenda/past')).expect(400)
    await past(seed.userA.id, { cursorDate: '2098-01-15' }).expect(400)
    await past(seed.userA.id, { cursorDate: 'nope', cursorId: 1 }).expect(400)
    await past(seed.userA.id, { limit: '0' }).expect(400)
  })
})

describe('GET /api/me/earnings', () => {
  const EARNINGS_WINDOW = { from: '2099-01-01', to: '2099-12-31' }
  const earnings = (userId, q = EARNINGS_WINDOW) =>
    asUser(userId)(request(app).get('/api/me/earnings').query(q))

  it('reports per band and never sums across them', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { role: 'financial_admin' })
    await addMembership(artist.id, seed.tenantB.id, { role: 'financial_admin' })

    const res = await earnings(artist.id).expect(200)
    const ids = res.body.items.map((r) => r.tenantId).sort()
    expect(ids).toEqual([seed.tenantA.id, seed.tenantB.id].sort())
    // Every row is one band's own figure; there is no combined total anywhere.
    for (const row of res.body.items) {
      expect(row).toHaveProperty('resultCents')
      expect(row.resultCents).toBe(row.revenueCents - row.expenseCents)
    }
    expect(res.body).not.toHaveProperty('total')
    expect(res.body.meta).not.toHaveProperty('total')
  })

  it('omits a band whose role denies finance.view to the caller', async () => {
    const artist = await createUser('artist@test.local')
    // reader has no finance.view; financial_admin does.
    await addMembership(artist.id, seed.tenantA.id, { role: 'reader' })
    await addMembership(artist.id, seed.tenantB.id, { role: 'financial_admin' })

    const res = await earnings(artist.id).expect(200)
    expect(res.body.items.map((r) => r.tenantId)).toEqual([seed.tenantB.id])
  })

  it('degrades rather than failing when every band denies finance', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { role: 'reader' })
    const res = await earnings(artist.id).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('never reports a band the caller is not an approved member of', async () => {
    const res = await earnings(seed.userA.id).expect(200)
    expect(res.body.items.map((r) => r.tenantId)).toEqual([seed.tenantA.id])
  })

  it('400s on a malformed window', async () => {
    await asUser(seed.userA.id)(request(app).get('/api/me/earnings')).expect(400)
    await earnings(seed.userA.id, { from: '2099-12-31', to: '2099-01-01' }).expect(400)
  })
})

describe('the hub tier', () => {
  it('rejects unauthenticated callers', async () => {
    await request(app).get('/api/me/bands').set('x-test-user-id', 'null').expect(401)
  })

  // The hub must never leak a tenant scope into the request: a later handler
  // relying on req.tenantId would silently read the wrong tenant.
  it('does not set an active tenant as a side effect', async () => {
    const { resolveMemberTenantIds } = await import('../../../server/middleware/tenant.js')
    const req = { session: { userId: seed.userA.id }, get: () => undefined, headers: {} }
    await new Promise((resolve, reject) => {
      resolveMemberTenantIds(req, { status: () => ({ json: reject }) }, (err) =>
        err ? reject(err) : resolve())
    })
    expect(req.memberTenantIds).toEqual([seed.tenantA.id])
    expect(req.tenantId).toBeUndefined()
    expect(req.membership).toBeUndefined()
  })
})
