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

// Availability is user-level, so /api/me/availability needs no active tenant.
const asUser = (userId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', 'null')

const inTenant = (userId, tenantId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', String(tenantId))

async function createUser(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, email.split('@')[0]],
  )
  return rows[0]
}

async function addMembership(userId, tenantId, role = 'contributor') {
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, $3, 'approved', NOW(), 'admin')`,
    [userId, tenantId, role],
  )
}

async function addBandMember(tenantId, name, userId = null) {
  const { rows } = await pool.query(
    `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
     VALUES ($1, $2, 'lead', 0, $3) RETURNING *`,
    [tenantId, name, userId],
  )
  return rows[0]
}

const RANGE = { from: '2099-07-01', to: '2099-07-31' }
const bandGrid = (userId, tenantId, range = RANGE) =>
  inTenant(userId, tenantId)(request(app).get('/api/availability').query(range))

describe('/api/me/availability — the musician\'s own calendar', () => {
  it('creates, lists and deletes without any active tenant', async () => {
    const created = await asUser(seed.userA.id)(request(app).post('/api/me/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable', reason: 'Holiday',
    })).expect(201)
    expect(created.body).toMatchObject({ status: 'unavailable', reason: 'Holiday' })

    const listed = await asUser(seed.userA.id)(
      request(app).get('/api/me/availability').query(RANGE),
    ).expect(200)
    expect(listed.body.items).toHaveLength(1)

    await asUser(seed.userA.id)(
      request(app).delete(`/api/me/availability/${created.body.id}`),
    ).expect(204)
  })

  it('validates the slot and the window', async () => {
    const as = asUser(seed.userA.id)
    await as(request(app).post('/api/me/availability').send({
      start_date: '2099-07-12', end_date: '2099-07-10', status: 'unavailable',
    })).expect(400)
    await as(request(app).post('/api/me/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'maybe',
    })).expect(400)
    await as(request(app).get('/api/me/availability')).expect(400)
  })

  // Availability belongs to the user; another account's row is simply not
  // reachable through this endpoint.
  it('never touches another user\'s slot', async () => {
    const created = await asUser(seed.userA.id)(request(app).post('/api/me/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable',
    })).expect(201)

    await asUser(seed.userB.id)(
      request(app).patch(`/api/me/availability/${created.body.id}`).send({ status: 'available' }),
    ).expect(404)
    await asUser(seed.userB.id)(
      request(app).delete(`/api/me/availability/${created.body.id}`),
    ).expect(404)

    const { rows } = await pool.query(
      'SELECT status FROM user_availability_slots WHERE id = $1', [created.body.id],
    )
    expect(rows[0].status).toBe('unavailable')
  })

  it('lists nothing from another user', async () => {
    await asUser(seed.userB.id)(request(app).post('/api/me/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable',
    })).expect(201)

    const res = await asUser(seed.userA.id)(
      request(app).get('/api/me/availability').query(RANGE),
    ).expect(200)
    expect(res.body.items).toEqual([])
  })
})

describe('privacy and delegation settings', () => {
  it('defaults both detail flags to off — private by default', async () => {
    const res = await asUser(seed.userA.id)(
      request(app).get('/api/me/availability/settings'),
    ).expect(200)
    expect(res.body).toMatchObject({
      availabilityDetailVisible: false,
      crossBandGigDetailVisible: false,
    })
  })

  it('lists one delegation row per band, defaulting to off', async () => {
    await addMembership(seed.userA.id, seed.tenantB.id)
    const res = await asUser(seed.userA.id)(
      request(app).get('/api/me/availability/settings'),
    ).expect(200)
    expect(res.body.delegations.map((d) => d.managedByBand)).toEqual([false, false])
  })

  it('updates the flags and a delegation', async () => {
    const res = await asUser(seed.userA.id)(
      request(app).patch('/api/me/availability/settings').send({
        availability_detail_visible: true,
        delegations: [{ tenantId: seed.tenantA.id, managedByBand: true }],
      }),
    ).expect(200)
    expect(res.body.availabilityDetailVisible).toBe(true)
    expect(res.body.delegations.find((d) => d.tenantId === seed.tenantA.id).managedByBand).toBe(true)
  })

  it('rejects non-boolean flags rather than coercing them', async () => {
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ availability_detail_visible: 'yes' })).expect(400)
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ delegations: [{ tenantId: seed.tenantA.id, managedByBand: 'yes' }] })).expect(400)

    const res = await asUser(seed.userA.id)(
      request(app).get('/api/me/availability/settings'),
    ).expect(200)
    expect(res.body.availabilityDetailVisible).toBe(false)
  })

  // Nobody but the musician may change these — not a bandmate, not an admin.
  // There is deliberately no band-side route that can reach them.
  it('cannot change another user\'s flags or delegation', async () => {
    await addMembership(seed.userB.id, seed.tenantA.id, 'tenant_admin')

    await asUser(seed.userB.id)(request(app).patch('/api/me/availability/settings').send({
      delegations: [{ tenantId: seed.tenantA.id, managedByBand: true }],
    })).expect(200)

    // userB flipped their OWN delegation for tenantA; userA's is untouched.
    const { rows } = await pool.query(
      `SELECT availability_managed_by_band FROM memberships
        WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    expect(rows[0].availability_managed_by_band).toBe(false)
  })
})

describe('what a band sees of a linked member\'s availability', () => {
  async function linkedMemberWithSlot(reason = 'Holiday') {
    // seed.memberA is already the roster row linked to userA in tenantA.
    const member = seed.memberA
    await asUser(seed.userA.id)(request(app).post('/api/me/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable', reason,
    })).expect(201)
    return member
  }

  it('shows the musician their own detail, always', async () => {
    await linkedMemberWithSlot()
    const res = await bandGrid(seed.userA.id, seed.tenantA.id).expect(200)
    const own = res.body.find((s) => s.source === 'slot')
    expect(own).toMatchObject({ reason: 'Holiday', redacted: false })
  })

  // The default: a bandmate sees busy, not why.
  it('hides the reason from a bandmate while the detail flag is off', async () => {
    await linkedMemberWithSlot()
    await addMembership(seed.userB.id, seed.tenantA.id)

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    const entry = res.body.find((s) => s.source === 'slot')
    expect(entry).toMatchObject({ status: 'unavailable', reason: null, redacted: true })
    // The redacted payload must not carry the reason at all.
    expect(JSON.stringify(res.body)).not.toContain('Holiday')
  })

  it('reveals the reason once the musician turns detail on', async () => {
    await linkedMemberWithSlot()
    await addMembership(seed.userB.id, seed.tenantA.id)
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ availability_detail_visible: true })).expect(200)

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((s) => s.source === 'slot')).toMatchObject({
      reason: 'Holiday', redacted: false,
    })
  })

  it('keeps an unlinked member\'s band-local slot working unchanged', async () => {
    const dep = await addBandMember(seed.tenantA.id, 'Dep Player', null)
    await inTenant(seed.userA.id, seed.tenantA.id)(request(app).post('/api/availability').send({
      band_member_id: dep.id,
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable', reason: 'Touring',
    })).expect(201)

    const res = await bandGrid(seed.userA.id, seed.tenantA.id).expect(200)
    const entry = res.body.find((s) => s.band_member_id === dep.id)
    expect(entry).toMatchObject({ status: 'unavailable', reason: 'Touring' })
  })
})

describe('bookings in other bands project as busy', () => {
  async function bookedElsewhere() {
    await addMembership(seed.userA.id, seed.tenantB.id)
    await addMembership(seed.userB.id, seed.tenantA.id)
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_description, event_date, status)
       VALUES ($1, 'Secret Other Show', '2099-07-15', 'confirmed')`,
      [seed.tenantB.id],
    )
  }

  it('shows opaque busy to another band while the cross-band flag is off', async () => {
    await bookedElsewhere()
    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)

    const booking = res.body.find((s) => s.source === 'booking')
    expect(booking).toMatchObject({ status: 'unavailable', redacted: true, title: null, tenantName: null })
    expect(JSON.stringify(res.body)).not.toContain('Secret Other Show')
    expect(JSON.stringify(res.body)).not.toContain('Beta Band')
  })

  it('names the band and title once the cross-band flag is on', async () => {
    await bookedElsewhere()
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ cross_band_gig_detail_visible: true })).expect(200)

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((s) => s.source === 'booking')).toMatchObject({
      title: 'Secret Other Show', tenantName: 'Beta Band', redacted: false,
    })
  })

  // A booking in THIS band is this band's own data — the viewer can already see
  // it on the gig itself, so hiding it in the grid would be theatre.
  it('never redacts this band\'s own booking', async () => {
    // seed.memberA already links userA into tenantA's roster.
    await addMembership(seed.userB.id, seed.tenantA.id)
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_description, event_date, status)
       VALUES ($1, 'Our Own Show', '2099-07-15', 'confirmed')`,
      [seed.tenantA.id],
    )

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((s) => s.source === 'booking')).toBeUndefined()
  })
})

describe('who may write a linked member\'s availability', () => {
  async function twoMembers() {
    const memberA = seed.memberA // already linked to userA in tenantA
    await addMembership(seed.userB.id, seed.tenantA.id, 'contributor')
    const memberB = await addBandMember(seed.tenantA.id, 'Alpha Member B', seed.userB.id)
    return { memberA, memberB }
  }

  const slotBody = (memberId) => ({
    band_member_id: memberId,
    start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable',
  })

  // A reader could not record their own availability before — planning.write
  // gated the whole route. availability.write.self fixes exactly that.
  it('lets a reader record their own availability', async () => {
    const reader = await createUser('reader@test.local')
    await addMembership(reader.id, seed.tenantA.id, 'reader')
    const member = await addBandMember(seed.tenantA.id, 'Reader', reader.id)

    await inTenant(reader.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(member.id)),
    ).expect(201)

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM user_availability_slots WHERE user_id = $1', [reader.id],
    )
    expect(rows[0].count).toBe(1)
  })

  it('refuses a contributor writing another member without delegation', async () => {
    const { memberA } = await twoMembers()
    const res = await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(memberA.id)),
    ).expect(403)
    expect(res.body.error).toMatch(/has not let this band manage/i)
  })

  it('allows it once the target delegates to this band', async () => {
    const { memberA } = await twoMembers()
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings').send({
      delegations: [{ tenantId: seed.tenantA.id, managedByBand: true }],
    })).expect(200)

    const created = await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(memberA.id)),
    ).expect(201)

    // The write lands on the musician's real calendar, tagged with who wrote it
    // from where, so they can review and revert.
    const { rows } = await pool.query(
      'SELECT user_id, created_by_user_id, created_in_tenant_id FROM user_availability_slots WHERE id = $1',
      [created.body.id],
    )
    expect(rows[0]).toEqual({
      user_id: seed.userA.id,
      created_by_user_id: seed.userB.id,
      created_in_tenant_id: seed.tenantA.id,
    })
  })

  // Delegation is per band: granting it to one grants nothing anywhere else.
  it('does not leak delegation to another band', async () => {
    const { memberA } = await twoMembers()
    // userB is already an approved member of tenantB in the fixture.
    await addMembership(seed.userA.id, seed.tenantB.id)
    const memberAinB = await addBandMember(seed.tenantB.id, 'Alpha Member A', seed.userA.id)

    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings').send({
      delegations: [{ tenantId: seed.tenantA.id, managedByBand: true }],
    })).expect(200)

    await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(memberA.id)),
    ).expect(201)
    await inTenant(seed.userB.id, seed.tenantB.id)(
      request(app).post('/api/availability').send(slotBody(memberAinB.id)),
    ).expect(403)
  })

  it('refuses a reader writing another member even with delegation', async () => {
    const { memberA } = await twoMembers()
    const reader = await createUser('reader@test.local')
    await addMembership(reader.id, seed.tenantA.id, 'reader')
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings').send({
      delegations: [{ tenantId: seed.tenantA.id, managedByBand: true }],
    })).expect(200)

    await inTenant(reader.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(memberA.id)),
    ).expect(403)
  })

  // The self permission must not become a way to edit band-owned rows.
  it('still requires planning.write for a band-wide slot', async () => {
    const reader = await createUser('reader@test.local')
    await addMembership(reader.id, seed.tenantA.id, 'reader')

    await inTenant(reader.id, seed.tenantA.id)(request(app).post('/api/availability').send({
      start_date: '2099-07-10', end_date: '2099-07-12', status: 'unavailable',
    })).expect(403)
  })

  it('still requires planning.write for an unlinked member\'s slot', async () => {
    const reader = await createUser('reader@test.local')
    await addMembership(reader.id, seed.tenantA.id, 'reader')
    const dep = await addBandMember(seed.tenantA.id, 'Dep Player', null)

    await inTenant(reader.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(dep.id)),
    ).expect(403)
  })

  it('applies the same rule to patch and delete', async () => {
    const { memberA } = await twoMembers()
    const created = await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).post('/api/availability').send(slotBody(memberA.id)),
    ).expect(201)

    await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).patch(`/api/availability/${created.body.id}`).send({ status: 'available' }),
    ).expect(403)
    await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).delete(`/api/availability/${created.body.id}`),
    ).expect(403)

    // The musician themselves still can.
    await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).delete(`/api/availability/${created.body.id}`),
    ).expect(204)
  })
})
