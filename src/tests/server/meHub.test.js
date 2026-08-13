import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let listMyUpcomingGigs, memberTenantScope
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const meGigMod = await import('../../../server/planning/agenda/meGigService.js')
  const scopeMod = await import('../../../server/domain/memberTenants.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  listMyUpcomingGigs = meGigMod.listMyUpcomingGigs
  memberTenantScope = scopeMod.memberTenantScope
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
       ON CONFLICT (user_id, tenant_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL DO NOTHING`,
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

async function addBandTenant(slug, name, ownerUserId) {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
     VALUES ($1, $2, $2, 'band', $3, $3) RETURNING *`,
    [slug, name, ownerUserId],
  )
  return tenant
}

// Counts the SQL a service issues, so a fan-out regression is caught by shape
// rather than by a stopwatch.
function countingExecutor() {
  const statements = []
  return {
    statements,
    db: {
      query: (text, values) => {
        statements.push(String(text))
        return pool.query(text, values)
      },
    },
  }
}

async function addPersonalWorkspace(ownerUserId, slug, name = 'Alpha Artist') {
  const { rows: [workspace] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
     VALUES ($1, $2, $2, 'personal', $3, $3) RETURNING *`,
    [slug, name, ownerUserId],
  )
  await addMembership(ownerUserId, workspace.id, { role: 'tenant_admin' })
  return workspace
}

async function addTask(tenantId, { title, userId, gigId = null, dueDate = null, done = false }) {
  const { rows } = await pool.query(
    `INSERT INTO gig_tasks (tenant_id, gig_id, title, due_date, done, assigned_to)
     VALUES ($1, $2, $3, $4, $5,
       (SELECT id FROM band_members WHERE tenant_id = $1 AND user_id = $6))
     RETURNING *`,
    [tenantId, gigId, title, dueDate, done, userId],
  )
  return rows[0]
}

async function addVenue(tenantId, { name, city, country = 'NL', lat = null, lon = null }) {
  const { rows } = await pool.query(
    `INSERT INTO venues (tenant_id, name, city, country, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, name, city, country, lat, lon],
  )
  return rows[0]
}

const WINDOW = { from: '2099-07-01', to: '2099-07-31' }
const agenda = (userId, q = WINDOW) =>
  asUser(userId)(request(app).get('/api/me/agenda').query(q))

const TODAY = '2099-01-01'
const hubGet = (userId, path, q) => asUser(userId)(request(app).get(path).query(q))

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

  it('lists an overnight gig once on its start date and exposes its derived end date', async () => {
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-10', name: 'Late show' })
    await pool.query(
      `UPDATE gigs SET end_date = '2099-07-11', start_time = '22:00', end_time = '02:00'
        WHERE id = $1 AND tenant_id = $2`,
      [gig.id, seed.tenantA.id],
    )

    const res = await agenda(seed.userA.id).expect(200)
    expect(res.body.items.filter((item) => item.id === gig.id && item.type === 'gig')).toEqual([
      expect.objectContaining({ date: '2099-07-10', endDate: '2099-07-11' }),
    ])
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

  it('includes the artist\'s own personal-workspace event through its fixed participant', async () => {
    const workspace = await addPersonalWorkspace(seed.userA.id, 'artist-agenda')
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

// The artist dashboard reads. Same tier and same participation rule as the
// agenda; each mirrors the envelope of its tenant-scoped sibling so the
// dashboard can swap one call for the other.
describe('GET /api/me/gigs/upcoming', () => {
  const upcoming = (userId, q = { today: TODAY }) => hubGet(userId, '/api/me/gigs/upcoming', q)

  it('merges upcoming gigs the artist plays across bands, soonest first', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    await addGig(seed.tenantB.id, { date: '2099-07-10', name: 'Later' })
    await addGig(seed.tenantA.id, { date: '2099-07-05', name: 'Sooner' })

    const res = await upcoming(artist.id).expect(200)
    expect(res.body.items.map((g) => g.event_description)).toEqual(['Sooner', 'Later'])
    expect(res.body.meta).toEqual({ limit: 10, returned: 2, total: 2 })
  })

  it('labels each gig with its band and omits the tenant-gated banner', async () => {
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-05' })
    await pool.query('UPDATE gigs SET banner_path = $2 WHERE id = $1',
      [gig.id, 'tenants/1/banners/secret.png'])

    const res = await upcoming(seed.userA.id).expect(200)
    expect(res.body.items[0]).toMatchObject({
      tenantId: seed.tenantA.id, tenantName: 'Alpha Band', kind: 'band',
    })
    expect(res.body.items[0]).not.toHaveProperty('banner_path')
  })

  it('omits a gig in the artist\'s band that they are not playing', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-05' })
    await pool.query('DELETE FROM gig_participants WHERE gig_id = $1', [gig.id])

    expect((await upcoming(artist.id).expect(200)).body.items).toEqual([])
  })

  it('includes the artist\'s own workspace gig through its fixed participant', async () => {
    const workspace = await addPersonalWorkspace(seed.userA.id, 'artist-gigs')
    await addGig(workspace.id, { date: '2099-07-05', name: 'Solo set' })
    const res = await upcoming(seed.userA.id).expect(200)
    expect(res.body.items.map((g) => g.event_description)).toEqual(['Solo set'])
  })

  it('never returns a gig from a tenant the caller is not a member of', async () => {
    await addGig(seed.tenantB.id, { date: '2099-07-05', name: 'Tenant B secret' })
    expect((await upcoming(seed.userA.id).expect(200)).body.items).toEqual([])
  })

  it('caps the page at limit while reporting the full total', async () => {
    await addGig(seed.tenantA.id, { date: '2099-07-05', name: 'One' })
    await addGig(seed.tenantA.id, { date: '2099-07-06', name: 'Two' })
    const res = await upcoming(seed.userA.id, { today: TODAY, limit: 1 }).expect(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.meta).toEqual({ limit: 1, returned: 1, total: 2 })
  })

  it('400s on a malformed today or limit', async () => {
    await upcoming(seed.userA.id, { today: 'nope' }).expect(400)
    await upcoming(seed.userA.id, {}).expect(400)
    await upcoming(seed.userA.id, { today: TODAY, limit: '0' }).expect(400)
  })
})

describe('GET /api/me/rehearsals/next', () => {
  const next = (userId) => hubGet(userId, '/api/me/rehearsals/next')

  it('returns the soonest planned rehearsal the artist is on, across bands', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    const later = await addRehearsal(seed.tenantA.id, { date: '2099-07-10', title: 'Later' })
    const sooner = await addRehearsal(seed.tenantB.id, { date: '2099-07-05', title: 'Sooner' })
    await pool.query('UPDATE rehearsals SET status = \'planned\' WHERE id = ANY($1)',
      [[later.id, sooner.id]])

    const res = await next(artist.id).expect(200)
    expect(res.body).toMatchObject({
      id: sooner.id, location: 'Sooner', tenantId: seed.tenantB.id, tenantName: 'Beta Band',
    })
  })

  it('returns null when nothing is planned for the artist', async () => {
    const rehearsal = await addRehearsal(seed.tenantA.id, { date: '2099-07-05' })
    await pool.query('UPDATE rehearsals SET status = \'planned\' WHERE id = $1', [rehearsal.id])
    await pool.query('DELETE FROM rehearsal_participants WHERE rehearsal_id = $1', [rehearsal.id])

    expect((await next(seed.userA.id).expect(200)).body).toBeNull()
  })

  it('never returns a rehearsal from a tenant the caller is not a member of', async () => {
    const rehearsal = await addRehearsal(seed.tenantB.id, { date: '2099-07-05', title: 'Tenant B secret' })
    await pool.query('UPDATE rehearsals SET status = \'planned\' WHERE id = $1', [rehearsal.id])
    expect((await next(seed.userA.id).expect(200)).body).toBeNull()
  })
})

describe('GET /api/me/band-events/upcoming', () => {
  const upcoming = (userId, q = { today: TODAY }) => hubGet(userId, '/api/me/band-events/upcoming', q)

  it('returns upcoming events the artist is required at, across bands', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    await addBandEvent(seed.tenantB.id, { start: '2099-07-10', end: '2099-07-10', title: 'Later' })
    await addBandEvent(seed.tenantA.id, { start: '2099-07-05', end: '2099-07-05', title: 'Sooner' })

    const res = await upcoming(artist.id).expect(200)
    expect(res.body.items.map((e) => e.title)).toEqual(['Sooner', 'Later'])
    expect(res.body.items[0]).toMatchObject({ tenantId: seed.tenantA.id, tenantName: 'Alpha Band' })
    expect(res.body.meta).toEqual({ limit: 10, returned: 2 })
  })

  it('omits an event the artist is not a participant of, and 400s on a bad window', async () => {
    const event = await addBandEvent(seed.tenantA.id, { start: '2099-07-05', end: '2099-07-05' })
    await pool.query('DELETE FROM band_event_participants WHERE band_event_id = $1', [event.id])
    expect((await upcoming(seed.userA.id).expect(200)).body.items).toEqual([])

    await upcoming(seed.userA.id, { today: 'nope' }).expect(400)
  })

  it('never returns an event from a tenant the caller is not a member of', async () => {
    await addBandEvent(seed.tenantB.id, { start: '2099-07-05', end: '2099-07-05', title: 'Tenant B secret' })
    expect((await upcoming(seed.userA.id).expect(200)).body.items).toEqual([])
  })
})

describe('GET /api/me/tasks', () => {
  const tasks = (userId, q) => hubGet(userId, '/api/me/tasks', q)

  it('returns only the tasks assigned to the caller, across bands', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-05', name: 'A Show' })
    await addTask(seed.tenantA.id, { title: 'Mine A', userId: artist.id, gigId: gig.id, dueDate: '2099-07-01' })
    await addTask(seed.tenantB.id, { title: 'Mine B', userId: artist.id, dueDate: '2099-07-02' })
    // Assigned to the other lead in the same band — same tenant, not the caller.
    await addTask(seed.tenantA.id, { title: 'Someone else', userId: seed.userA.id })
    // Assigned to nobody.
    await addTask(seed.tenantA.id, { title: 'Unassigned', userId: null })

    const res = await tasks(artist.id).expect(200)
    expect(res.body.items.map((t) => t.title)).toEqual(['Mine A', 'Mine B'])
    expect(res.body.items[0]).toMatchObject({
      event_description: 'A Show', tenantId: seed.tenantA.id, tenantName: 'Alpha Band',
    })
    expect(res.body.meta).toEqual({ limit: 10, returned: 2, total: 2 })
  })

  it('filters on done and reports the total behind a capped page', async () => {
    await addTask(seed.tenantA.id, { title: 'Open one', userId: seed.userA.id, dueDate: '2099-07-01' })
    await addTask(seed.tenantA.id, { title: 'Open two', userId: seed.userA.id, dueDate: '2099-07-02' })
    await addTask(seed.tenantA.id, { title: 'Closed', userId: seed.userA.id, done: true })

    const open = await tasks(seed.userA.id, { done: 'false' }).expect(200)
    expect(open.body.items.map((t) => t.title)).toEqual(['Open one', 'Open two'])

    const capped = await tasks(seed.userA.id, { done: 'false', limit: 1 }).expect(200)
    expect(capped.body.meta).toEqual({ limit: 1, returned: 1, total: 2 })
  })

  it('ignores an assignee supplied by the client — the hub is always "mine"', async () => {
    const { rows: [other] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order)
       VALUES ($1, 'Dep', 'lead', 200) RETURNING *`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gig_tasks (tenant_id, title, assigned_to) VALUES ($1, 'Dep task', $2)`,
      [seed.tenantA.id, other.id],
    )
    const res = await tasks(seed.userA.id, { assignee: other.id }).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('never returns a task from a tenant the caller is not a member of', async () => {
    await addTask(seed.tenantB.id, { title: 'Tenant B secret', userId: seed.userB.id })
    expect((await tasks(seed.userA.id).expect(200)).body.items).toEqual([])
  })

  it('400s on a malformed done or limit', async () => {
    await tasks(seed.userA.id, { done: 'maybe' }).expect(400)
    await tasks(seed.userA.id, { limit: '501' }).expect(400)
  })
})

describe('GET /api/me/gigs/map', () => {
  const MAP_WINDOW = { from: '2000-01-01', to: '2099-12-31' }
  const map = (userId, q = MAP_WINDOW) => hubGet(userId, '/api/me/gigs/map', q)

  it('returns the minimal place projection for gigs the artist played, across bands', async () => {
    const artist = await createUser('artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    await addMembership(artist.id, seed.tenantB.id)
    const venue = await addVenue(seed.tenantB.id, { name: 'Paradiso', city: 'Amsterdam', lat: 52.3, lon: 4.88 })
    const gig = await addGig(seed.tenantB.id, { date: '2099-07-05', name: 'Played here' })
    await pool.query('UPDATE gigs SET venue_id = $2 WHERE id = $1', [gig.id, venue.id])

    const res = await map(artist.id).expect(200)
    expect(res.body.items).toEqual([expect.objectContaining({
      id: gig.id,
      event_description: 'Played here',
      venue: expect.objectContaining({ city: 'Amsterdam', latitude: 52.3, longitude: 4.88 }),
      tenantId: seed.tenantB.id,
      tenantName: 'Beta Band',
    })])
    expect(res.body.meta).toEqual({ from: MAP_WINDOW.from, to: MAP_WINDOW.to, returned: 1 })
  })

  it('never returns a gig from a tenant the caller is not a member of, and 400s on a bad window', async () => {
    await addGig(seed.tenantB.id, { date: '2099-07-05', name: 'Tenant B secret' })
    expect((await map(seed.userA.id).expect(200)).body.items).toEqual([])

    await map(seed.userA.id, { from: '2099-12-31', to: '2000-01-01' }).expect(400)
    await map(seed.userA.id, { from: '2000-01-01' }).expect(400)
  })
})

describe('/api/me planning details and self-actions', () => {
  it('preserves past-gig cursor ordering and scopes cross-tenant search', async () => {
    const older = await addGig(seed.tenantA.id, { date: '2098-01-01', name: 'Needle older' })
    const newer = await addGig(seed.tenantA.id, { date: '2098-02-01', name: 'Needle newer' })
    await addGig(seed.tenantB.id, { date: '2098-03-01', name: 'Needle foreign' })

    const first = await hubGet(seed.userA.id, '/api/me/gigs/past', { today: TODAY, limit: 1 }).expect(200)
    expect(first.body.items.map((gig) => gig.id)).toEqual([newer.id])
    const second = await hubGet(seed.userA.id, '/api/me/gigs/past', {
      today: TODAY,
      limit: 1,
      cursorDate: first.body.meta.nextCursor.date,
      cursorId: first.body.meta.nextCursor.id,
    }).expect(200)
    expect(second.body.items.map((gig) => gig.id)).toEqual([older.id])

    const search = await hubGet(seed.userA.id, '/api/me/gigs/search', { q: 'Needle' }).expect(200)
    expect(search.body.map((gig) => gig.event_description)).toEqual(['Needle newer', 'Needle older'])
  })

  // The message belongs to the parser, not to each caller: a half-supplied
  // cursor must read the same here as it does on the tenant-scoped feeds.
  it('rejects a malformed cursor with the same message as the tenant-scoped feeds', async () => {
    const expected = { error: 'cursorDate and cursorId must be provided together and valid' }
    for (const path of ['/api/me/gigs/past', '/api/me/rehearsals/past', '/api/me/band-events/past']) {
      const res = await hubGet(seed.userA.id, path, { today: TODAY, cursorDate: '2098-01-01' }).expect(400)
      expect(res.body).toEqual(expected)
    }
  })

  it('returns a restricted gig detail and 404s when participation is missing', async () => {
    const artist = await createUser('detail-artist@test.local')
    await addMembership(artist.id, seed.tenantA.id)
    const gig = await addGig(seed.tenantA.id, { date: '2099-07-05', name: 'Restricted show' })
    await pool.query('UPDATE gigs SET banner_path = $2 WHERE id = $1', [gig.id, 'tenants/1/gigs/banner.png'])
    await addTask(seed.tenantA.id, { title: 'Mine', userId: artist.id, gigId: gig.id })
    await addTask(seed.tenantA.id, { title: 'Not mine', userId: seed.userA.id, gigId: gig.id })
    await pool.query(
      `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
       VALUES ($1, $2, 'tenants/1/attachments/secret.pdf', 'rider.pdf', 'application/pdf', 10)`,
      [gig.id, seed.tenantA.id],
    )

    const res = await hubGet(artist.id, `/api/me/gigs/${gig.id}`).expect(200)
    expect(res.body).not.toHaveProperty('banner_path')
    expect(res.body).not.toHaveProperty('participants')
    expect(res.body.tasks.map((task) => task.title)).toEqual(['Mine'])
    expect(res.body.attachments[0]).toMatchObject({ original_filename: 'rider.pdf' })
    expect(res.body.attachments[0]).not.toHaveProperty('object_key')

    await pool.query('DELETE FROM gig_participants WHERE gig_id = $1 AND band_member_id = $2', [
      gig.id,
      (await pool.query('SELECT id FROM band_members WHERE tenant_id = $1 AND user_id = $2',
        [seed.tenantA.id, artist.id])).rows[0].id,
    ])
    await hubGet(artist.id, `/api/me/gigs/${gig.id}`).expect(404)
    await hubGet(seed.userB.id, `/api/me/gigs/${gig.id}`).expect(404)
  })

  it('keeps rehearsal voting on the reader self path and fires its notification', async () => {
    const artist = await createUser('vote-artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { role: 'tenant_admin' })
    const rehearsal = await addRehearsal(seed.tenantA.id, { date: '2099-07-05', title: 'Vote here' })
    const { rows: [member] } = await pool.query(
      'SELECT id FROM band_members WHERE tenant_id = $1 AND user_id = $2',
      [seed.tenantA.id, artist.id],
    )
    await pool.query(
      `UPDATE rehearsal_participants SET vote = NULL
        WHERE tenant_id = $1 AND rehearsal_id = $2 AND band_member_id = $3`,
      [seed.tenantA.id, rehearsal.id, member.id],
    )

    const detail = await hubGet(artist.id, `/api/me/rehearsals/${rehearsal.id}`).expect(200)
    expect(detail.body).toMatchObject({ tenantId: seed.tenantA.id, viewerBandMemberId: member.id })

    await asUser(artist.id)(request(app).patch(`/api/me/rehearsals/${rehearsal.id}/vote`)
      .send({ vote: 'no', status: 'planned' })).expect(400)
    await asUser(artist.id)(request(app).patch(`/api/me/rehearsals/${rehearsal.id}/vote`)
      .send({ vote: 'no', band_member_id: 999999 })).expect(400)

    const voted = await asUser(artist.id)(request(app).patch(`/api/me/rehearsals/${rehearsal.id}/vote`)
      .send({ vote: 'no' })).expect(200)
    expect(voted.body.participants.find((participant) => participant.band_member_id === member.id).vote).toBe('no')
    const notification = await pool.query(
      `SELECT type FROM notifications WHERE tenant_id = $1 AND source_type = 'rehearsal' AND source_id = $2`,
      [seed.tenantA.id, rehearsal.id],
    )
    expect(notification.rows.map((row) => row.type)).toContain('option-member-unavailable')

    const foreign = await addRehearsal(seed.tenantB.id, { date: '2099-07-06', title: 'Foreign' })
    await asUser(artist.id)(request(app).patch(`/api/me/rehearsals/${foreign.id}/vote`)
      .send({ vote: 'yes' })).expect(404)
  })

  it('only completes the caller assigned band task and rejects field escalation', async () => {
    const artist = await createUser('task-artist@test.local')
    await addMembership(artist.id, seed.tenantA.id, { role: 'tenant_admin' })
    const mine = await addTask(seed.tenantA.id, { title: 'Mine', userId: artist.id })
    const other = await addTask(seed.tenantA.id, { title: 'Other', userId: seed.userA.id })
    const unassigned = await addTask(seed.tenantA.id, { title: 'Nobody', userId: null })

    await asUser(artist.id)(request(app).patch(`/api/me/tasks/${mine.id}/done`)
      .send({ done: true, title: 'Escalated' })).expect(400)
    await asUser(artist.id)(request(app).patch(`/api/me/tasks/${other.id}/done`)
      .send({ done: true })).expect(404)
    await asUser(artist.id)(request(app).patch(`/api/me/tasks/${unassigned.id}/done`)
      .send({ done: true })).expect(404)
    await asUser(artist.id)(request(app).patch(`/api/me/tasks/${mine.id}/done`)
      .send({ done: 'yes' })).expect(400)

    const completed = await asUser(artist.id)(request(app).patch(`/api/me/tasks/${mine.id}/done`)
      .send({ done: true })).expect(200)
    expect(completed.body).toMatchObject({ id: mine.id, done: true, tenantId: seed.tenantA.id })
  })

  it('includes every task in the owned personal workspace but not someone else\'s personal tenant', async () => {
    const own = await addPersonalWorkspace(seed.userA.id, 'my-planning')
    await pool.query(`INSERT INTO gig_tasks (tenant_id, title) VALUES ($1, 'Unassigned personal')`, [own.id])

    const foreignOwner = await createUser('foreign-owner@test.local')
    const foreign = await addPersonalWorkspace(foreignOwner.id, 'foreign-planning')
    await addMembership(seed.userA.id, foreign.id)
    await pool.query(`INSERT INTO gig_tasks (tenant_id, title) VALUES ($1, 'Foreign personal')`, [foreign.id])

    const res = await hubGet(seed.userA.id, '/api/me/tasks').expect(200)
    expect(res.body.items.map((task) => task.title)).toContain('Unassigned personal')
    expect(res.body.items.map((task) => task.title)).not.toContain('Foreign personal')
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
    expect(req.memberTenants.ids).toEqual([seed.tenantA.id])
    expect(req.tenantId).toBeUndefined()
    expect(req.membership).toBeUndefined()
  })
})

// The user-level half of an availability matrix (a musician's own slots, and
// their bookings across every band they play in) is keyed by USER, not tenant.
// The hub builds one matrix per band in the feed, so fetching that half per
// band repeated the single heaviest query in the domain N times — and fired
// them concurrently at a connection pool of five.
describe('cross-tenant availability shares the user-level fetch', () => {
  const CROSS_TENANT_BOOKINGS = 'member_tenants'

  async function threeBandsWithGigs() {
    const bandB = await addBandTenant('shared-b', 'Shared B', seed.userA.id)
    const bandC = await addBandTenant('shared-c', 'Shared C', seed.userA.id)
    await addMembership(seed.userA.id, bandB.id)
    await addMembership(seed.userA.id, bandC.id)
    for (const tenantId of [seed.tenantA.id, bandB.id, bandC.id]) {
      await addGig(tenantId, { date: '2099-07-10' })
    }
    return [
      { tenantId: seed.tenantA.id, displayName: 'Alpha Band', kind: 'band' },
      { tenantId: bandB.id, displayName: 'Shared B', kind: 'band' },
      { tenantId: bandC.id, displayName: 'Shared C', kind: 'band' },
    ]
  }

  it('runs the cross-tenant booking query once for a feed spanning three bands', async () => {
    const tenants = await threeBandsWithGigs()
    const { statements, db } = countingExecutor()

    const result = await listMyUpcomingGigs(db, seed.userA.id, memberTenantScope(tenants), {
      limit: 10, today: '2099-01-01',
    })

    expect(result.items).toHaveLength(3)
    expect(statements.filter((sql) => sql.includes(CROSS_TENANT_BOOKINGS))).toHaveLength(1)
  })

  // The shared fetch must not lose the cross-band half of the picture: all
  // three gigs are on the same day, so each one sees the other two as bookings.
  it('still labels every band and sees the bookings in the other two', async () => {
    const tenants = await threeBandsWithGigs()

    const result = await listMyUpcomingGigs(pool, seed.userA.id, memberTenantScope(tenants), {
      limit: 10, today: '2099-01-01',
    })

    expect(result.items.map((gig) => gig.tenantName).sort()).toEqual(['Alpha Band', 'Shared B', 'Shared C'])
    for (const gig of result.items) {
      expect(gig.members_availability.length).toBeGreaterThan(0)
      expect(gig.members_availability.some((m) => m.source === 'booking')).toBe(true)
    }
  })

  it('leaves a member available when their other bands are busy on other days', async () => {
    const bandB = await addBandTenant('spread-b', 'Spread B', seed.userA.id)
    await addMembership(seed.userA.id, bandB.id)
    await addGig(seed.tenantA.id, { date: '2099-07-10' })
    await addGig(bandB.id, { date: '2099-08-20' })

    const result = await listMyUpcomingGigs(pool, seed.userA.id, memberTenantScope([
      { tenantId: seed.tenantA.id, displayName: 'Alpha Band', kind: 'band' },
      { tenantId: bandB.id, displayName: 'Spread B', kind: 'band' },
    ]), { limit: 10, today: '2099-01-01' })

    for (const gig of result.items) {
      expect(gig.members_availability.every((m) => m.status === 'available')).toBe(true)
    }
  })
})
