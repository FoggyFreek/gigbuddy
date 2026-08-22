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
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedBandMembers(seed)
  seed = await fixtureDb.seedGigsAndTasks(seed)
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

// Every availability read fans out over four range-scoped queries, so the
// window has to be bounded at the door — MAX_SPAN_DAYS only ever truncated the
// computed output, long after the rows had been fetched.
describe('availability reads reject an unbounded window', () => {
  const TOO_WIDE = { from: '2000-01-01', to: '2099-12-31' }

  it('rejects a window wider than a year on the band grid', async () => {
    await bandGrid(seed.userA.id, seed.tenantA.id, TOO_WIDE).expect(400)
  })

  it('rejects a malformed window on the band grid instead of failing in the database', async () => {
    await bandGrid(seed.userA.id, seed.tenantA.id, { from: 'yesterday', to: '2099-07-31' }).expect(400)
    await bandGrid(seed.userA.id, seed.tenantA.id, { from: '2099-07-31', to: '2099-07-01' }).expect(400)
  })

  it('rejects a window wider than a year on the span and personal reads', async () => {
    await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).get('/api/availability/span').query(TOO_WIDE),
    ).expect(400)
    await asUser(seed.userA.id)(
      request(app).get('/api/me/availability').query(TOO_WIDE),
    ).expect(400)
  })

  it('still accepts a full year', async () => {
    await bandGrid(seed.userA.id, seed.tenantA.id, { from: '2099-01-01', to: '2099-12-31' }).expect(200)
  })
})

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
      travelMarginHours: 2,
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

  it('updates and validates the travel margin', async () => {
    const updated = await asUser(seed.userA.id)(
      request(app).patch('/api/me/availability/settings').send({ travel_margin_hours: 5 }),
    ).expect(200)
    expect(updated.body.travelMarginHours).toBe(5)

    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ travel_margin_hours: 2.5 })).expect(400)
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ travel_margin_hours: 25 })).expect(400)
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
  async function linkUserToTenant(userId, tenantId, name = 'Visiting Artist') {
    await addMembership(userId, tenantId)
    await addMembership(seed.userB.id, seed.tenantA.id)
    return addBandMember(tenantId, name, userId)
  }

  async function addRequiredGig(tenantId, memberId, title = 'Secret Other Show') {
    const { rows: [gig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_description, event_date, status)
       VALUES ($1, $2, '2099-07-15', 'confirmed') RETURNING *`,
      [tenantId, title],
    )
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
       VALUES ($1, $2, $3)`,
      [tenantId, gig.id, memberId],
    )
    return gig
  }

  async function bookedElsewhere() {
    const member = await linkUserToTenant(seed.userA.id, seed.tenantB.id)
    await addRequiredGig(seed.tenantB.id, member.id)
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
      title: 'Secret Other Show',
      tenantName: 'Beta Band',
      description: 'Secret Other Show — Beta Band',
      redacted: false,
    })
  })

  it.each([
    ['rehearsal', 'Other band rehearsal'],
    ['band_event', 'Other band event'],
  ])('marks a required member unavailable because of another band %s', async (kind, title) => {
    const member = await linkUserToTenant(seed.userA.id, seed.tenantB.id)
    let eventId
    if (kind === 'rehearsal') {
      const { rows: [event] } = await pool.query(
        `INSERT INTO rehearsals (tenant_id, proposed_date, location, status)
         VALUES ($1, '2099-07-16', $2, 'planned') RETURNING *`,
        [seed.tenantB.id, title],
      )
      eventId = event.id
      await pool.query(
        `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id, vote)
         VALUES ($1, $2, $3, 'yes')`,
        [seed.tenantB.id, eventId, member.id],
      )
    } else {
      const { rows: [event] } = await pool.query(
        `INSERT INTO band_events (tenant_id, title, start_date, end_date)
         VALUES ($1, $2, '2099-07-16', '2099-07-17') RETURNING *`,
        [seed.tenantB.id, title],
      )
      eventId = event.id
      await pool.query(
        `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
         VALUES ($1, $2, $3)`,
        [seed.tenantB.id, eventId, member.id],
      )
    }
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ cross_band_gig_detail_visible: true })).expect(200)

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((slot) => slot.bookingType === kind)).toMatchObject({
      source: 'booking',
      title,
      tenantName: 'Beta Band',
      description: `${title} — Beta Band`,
      redacted: false,
    })
  })

  it('marks an artist unavailable because of their own personal-workspace event', async () => {
    const { rows: [personal] } = await pool.query(
      `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
       VALUES ('artist-calendar', 'Alpha Artist', 'Alpha Artist', 'personal', $1, $1) RETURNING *`,
      [seed.userA.id],
    )
    await addMembership(seed.userA.id, personal.id, 'tenant_admin')
    await addMembership(seed.userB.id, seed.tenantA.id)
    await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Private artist appointment', '2099-07-18', '2099-07-18')`,
      [personal.id],
    )
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ cross_band_gig_detail_visible: true })).expect(200)

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((slot) => slot.bookingType === 'band_event')).toMatchObject({
      title: 'Private artist appointment',
      tenantName: 'Alpha Artist',
      description: 'Private artist appointment — Alpha Artist',
    })
  })

  it('does not derive availability from an event where the artist is not required', async () => {
    await linkUserToTenant(seed.userA.id, seed.tenantB.id)
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_description, event_date, status)
       VALUES ($1, 'Not my show', '2099-07-15', 'confirmed')`,
      [seed.tenantB.id],
    )

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.find((slot) => slot.source === 'booking')).toBeUndefined()
  })

  it('omits a current-tenant band event from availability while keeping cross-tenant bookings', async () => {
    // seed.memberA already links userA into tenantA's roster. The band event is
    // rendered by the event calendar endpoint and must not become a second,
    // derived availability block.
    const { rows: [event] } = await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Our Own Event', '2099-07-15', '2099-07-15') RETURNING *`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
       VALUES ($1, $2, $3)`,
      [seed.tenantA.id, event.id, seed.memberA.id],
    )
    await bookedElsewhere()

    const res = await bandGrid(seed.userB.id, seed.tenantA.id).expect(200)
    expect(res.body.some((slot) => slot.source === 'booking'
      && slot.createdInTenantId === seed.tenantA.id)).toBe(false)
    expect(res.body.some((slot) => slot.source === 'booking'
      && slot.createdInTenantId === seed.tenantB.id)).toBe(true)
  })

  it('does not let a derived booking be patched or deleted as an availability slot', async () => {
    await bookedElsewhere()
    const grid = await bandGrid(seed.userA.id, seed.tenantA.id).expect(200)
    const booking = grid.body.find((slot) => slot.source === 'booking')
    expect(booking.id).toMatch(/^gig-/)

    await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).patch(`/api/availability/${booking.id}`).send({ status: 'available' }),
    ).expect(400)
    await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).delete(`/api/availability/${booking.id}`),
    ).expect(400)
  })
})

describe('event availability evaluation', () => {
  async function addTimedOption(vote = null) {
    const { rows: [gig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_description, event_date, start_time, end_time, status)
       VALUES ($1, 'Timed option', '2099-07-15', '18:00', '20:00', 'option') RETURNING *`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id, vote)
       VALUES ($1, $2, $3, $4)`,
      [seed.tenantA.id, gig.id, seed.memberA.id, vote],
    )
    return gig
  }

  const evaluate = (body) => inTenant(seed.userA.id, seed.tenantA.id)(
    request(app).post('/api/availability/evaluate').send({
      event_type: 'rehearsal',
      start_date: '2099-07-15',
      participant_ids: [seed.memberA.id],
      ...body,
    }),
  )

  it('uses every event status and distinguishes overlap, travel margin, and a sufficient gap', async () => {
    await addTimedOption()

    expect((await evaluate({ start_time: '19:00', end_time: '21:00' }).expect(200))
      .body.members[0].status).toBe('unavailable')
    expect((await evaluate({ start_time: '21:00', end_time: '22:00' }).expect(200))
      .body.members[0].status).toBe('travel_margin')
    expect((await evaluate({ start_time: '22:00', end_time: '23:00' }).expect(200))
      .body.members[0].status).toBe('available')
  })

  it('uses the participant\'s configured travel margin', async () => {
    await addTimedOption()
    await asUser(seed.userA.id)(request(app).patch('/api/me/availability/settings')
      .send({ travel_margin_hours: 4 })).expect(200)

    expect((await evaluate({ start_time: '22:00', end_time: '23:00' }).expect(200))
      .body.members[0].status).toBe('travel_margin')
  })

  it('does not reserve time for a participant who voted no', async () => {
    await addTimedOption('no')
    expect((await evaluate({ start_time: '19:00', end_time: '21:00' }).expect(200))
      .body.members[0].status).toBe('available')
  })

  it('excludes the current event and validates its tenant scope', async () => {
    const gig = await addTimedOption()
    const own = await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).post('/api/availability/evaluate').send({
        event_type: 'gig', event_id: gig.id, start_date: '2099-07-15',
        start_time: '18:00', end_time: '20:00', participant_ids: [seed.memberA.id],
      }),
    ).expect(200)
    expect(own.body.members[0].status).toBe('available')

    await inTenant(seed.userA.id, seed.tenantA.id)(request(app).post('/api/availability/evaluate').send({
      event_type: 'gig', event_id: seed.gigB.id, start_date: '2099-07-15',
      participant_ids: [seed.memberA.id],
    })).expect(404)
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

  it('lets the artist create in one band calendar and remove from another', async () => {
    await addMembership(seed.userA.id, seed.tenantB.id, 'reader')
    const memberInB = await addBandMember(seed.tenantB.id, 'Alpha Member in Beta', seed.userA.id)
    const created = await inTenant(seed.userA.id, seed.tenantB.id)(
      request(app).post('/api/availability').send(slotBody(memberInB.id)),
    ).expect(201)

    const visibleInA = await bandGrid(seed.userA.id, seed.tenantA.id).expect(200)
    expect(visibleInA.body).toContainEqual(expect.objectContaining({
      id: created.body.id,
      source: 'slot',
      status: 'unavailable',
    }))

    await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).delete(`/api/availability/${created.body.id}`),
    ).expect(204)
    expect((await asUser(seed.userA.id)(
      request(app).get('/api/me/availability').query(RANGE),
    ).expect(200)).body.items).toEqual([])
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

    const roster = await inTenant(seed.userB.id, seed.tenantA.id)(
      request(app).get('/api/band-members'),
    ).expect(200)
    expect(roster.body.find((member) => member.id === memberA.id))
      .toMatchObject({ availability_managed_by_band: true })
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
