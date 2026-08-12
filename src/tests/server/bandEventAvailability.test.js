import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

const inTenant = (userId, tenantId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', String(tenantId))

const asUserA = (req) => inTenant(seed.userA.id, seed.tenantA.id)(req)

// 2027 avoids the 2026 fixtures seedTwoTenants creates.
const SPAN = { start: '2027-09-10', end: '2027-09-12' }

async function addEvent(tenantId, title, start, end = start) {
  const { rows: [event] } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, title, start, end],
  )
  await pool.query(
    `INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
     SELECT $1, $2, id
       FROM band_members
      WHERE tenant_id = $1 AND position = 'lead'`,
    [tenantId, event.id],
  )
  return event
}

async function addBandSlot(tenantId, bandMemberId, start, end, status, reason = null) {
  await pool.query(
    `INSERT INTO availability_slots (tenant_id, band_member_id, start_date, end_date, status, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, bandMemberId, start, end, status, reason],
  )
}

// A second musician in tenant A, with their own account — the case where
// availability is user-level and reaches the band only as a projection.
async function addLinkedMember(tenantId, email, name) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, name],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'contributor', 'approved', NOW(), 'invite')`,
    [user.id, tenantId],
  )
  const { rows: [member] } = await pool.query(
    `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
     VALUES ($1, $2, 'lead', 1, $3) RETURNING *`,
    [tenantId, name, user.id],
  )
  return { user, member }
}

async function addUserSlot(userId, start, end, status, reason = null) {
  await pool.query(
    `INSERT INTO user_availability_slots (user_id, start_date, end_date, status, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, start, end, status, reason],
  )
}

// A personal workspace owned by user A: an ordinary tenant with no roster.
async function addPersonalWorkspace(slug = 'solo-ws') {
  const { rows: [workspace] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
     VALUES ($1, 'Solo', 'Solo', 'personal', $2, $2) RETURNING *`,
    [slug, seed.userA.id],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [seed.userA.id, workspace.id],
  )
  return workspace
}

const memberEntry = (payload, memberId) =>
  payload.members_availability.find((m) => m.member_id === memberId)

const dayEntry = (payload, date, memberId) =>
  payload.availability_days.find((d) => d.date === date).members.find((m) => m.member_id === memberId)

describe('band event availability', () => {
  it('summarises a multi-day event by its worst day and breaks the span down per day', async () => {
    const event = await addEvent(seed.tenantA.id, 'Studio week', SPAN.start, SPAN.end)
    await addBandSlot(seed.tenantA.id, seed.memberA.id, '2027-09-11', '2027-09-11', 'unavailable', 'Dentist')

    const res = await asUserA(request(app).get(`/api/band-events/${event.id}`)).expect(200)

    expect(memberEntry(res.body, seed.memberA.id)).toMatchObject({
      name: 'Alpha Member', status: 'unavailable', reason: 'Dentist',
    })
    expect(res.body.availability_days.map((d) => d.date)).toEqual([
      '2027-09-10', '2027-09-11', '2027-09-12',
    ])
    expect(dayEntry(res.body, '2027-09-10', seed.memberA.id)).toMatchObject({ status: 'available', reason: null })
    expect(dayEntry(res.body, '2027-09-11', seed.memberA.id)).toMatchObject({ status: 'unavailable', reason: 'Dentist' })
    expect(dayEntry(res.body, '2027-09-12', seed.memberA.id)).toMatchObject({ status: 'available' })
  })

  it('lets a band-wide slot win over a member slot', async () => {
    const event = await addEvent(seed.tenantA.id, 'Band meeting', '2027-09-10')
    await addBandSlot(seed.tenantA.id, seed.memberA.id, '2027-09-10', '2027-09-10', 'available')
    await addBandSlot(seed.tenantA.id, null, '2027-09-10', '2027-09-10', 'unavailable', 'Studio closed')

    const res = await asUserA(request(app).get(`/api/band-events/${event.id}`)).expect(200)

    expect(memberEntry(res.body, seed.memberA.id)).toMatchObject({
      status: 'unavailable', reason: 'Studio closed', source: 'band',
    })
    expect(res.body.availability_days[0].bandWide).toEqual({ status: 'unavailable', reason: 'Studio closed' })
  })

  it('projects another member\'s user-level slot, and redacts the reason until they share it', async () => {
    const { user, member } = await addLinkedMember(seed.tenantA.id, 'sideman@test.local', 'Sideman')
    const event = await addEvent(seed.tenantA.id, 'Photo shoot', '2027-09-10')
    await addUserSlot(user.id, '2027-09-10', '2027-09-10', 'unavailable', 'Family wedding')

    const hidden = await asUserA(request(app).get(`/api/band-events/${event.id}`)).expect(200)
    expect(memberEntry(hidden.body, member.id)).toMatchObject({
      name: 'Sideman', status: 'unavailable', reason: null,
    })
    expect(JSON.stringify(hidden.body)).not.toContain('Family wedding')

    await pool.query('UPDATE users SET availability_detail_visible = TRUE WHERE id = $1', [user.id])

    const shared = await asUserA(request(app).get(`/api/band-events/${event.id}`)).expect(200)
    expect(memberEntry(shared.body, member.id)).toMatchObject({
      status: 'unavailable', reason: 'Family wedding',
    })
  })

  it('carries the summary on the list feeds, and the per-day breakdown only on the detail', async () => {
    await addEvent(seed.tenantA.id, 'Rehearsal weekend', '2027-09-10', '2027-09-12')
    await addBandSlot(seed.tenantA.id, seed.memberA.id, '2027-09-12', '2027-09-12', 'unavailable')

    const upcoming = await asUserA(request(app)
      .get('/api/band-events/upcoming').query({ limit: 10, today: '2027-09-01' })).expect(200)

    const listed = upcoming.body.items.find((e) => e.title === 'Rehearsal weekend')
    expect(memberEntry(listed, seed.memberA.id)).toMatchObject({ status: 'unavailable' })
    expect(listed.availability_days).toBeUndefined()

    const past = await asUserA(request(app)
      .get('/api/band-events/past').query({ limit: 10, today: '2027-10-01' })).expect(200)
    expect(memberEntry(past.body.items.find((e) => e.title === 'Rehearsal weekend'), seed.memberA.id))
      .toMatchObject({ status: 'unavailable' })
  })

  it('omits availability in a personal workspace, which has no band roster', async () => {
    const workspace = await addPersonalWorkspace()
    const event = await addEvent(workspace.id, 'Practice block', '2027-09-10', '2027-09-12')

    const res = await inTenant(seed.userA.id, workspace.id)(
      request(app).get(`/api/band-events/${event.id}`)).expect(200)

    expect(res.body).not.toHaveProperty('members_availability')
    expect(res.body).not.toHaveProperty('availability_days')
  })

  it('creates a personal event in a personal workspace and shows it on that calendar only', async () => {
    const workspace = await addPersonalWorkspace('solo-create-ws')

    const created = await inTenant(seed.userA.id, workspace.id)(request(app).post('/api/band-events').send({
      title: 'Studio day', start_date: SPAN.start, location: 'Home studio',
    })).expect(201)

    expect(created.body).toMatchObject({
      title: 'Studio day', location: 'Home studio', tenant_id: workspace.id,
    })
    // No roster, so the lead-member default has nobody to add.
    const { rows: participants } = await pool.query(
      'SELECT * FROM band_event_participants WHERE band_event_id = $1', [created.body.id],
    )
    expect(participants).toHaveLength(0)

    const calendar = await inTenant(seed.userA.id, workspace.id)(request(app)
      .get('/api/band-events/range').query({ from: SPAN.start, to: SPAN.end })).expect(200)
    expect(calendar.body.items.map((event) => event.title)).toEqual(['Studio day'])

    const bandCalendar = await asUserA(request(app)
      .get('/api/band-events/range').query({ from: SPAN.start, to: SPAN.end })).expect(200)
    expect(bandCalendar.body.items).toHaveLength(0)
    await asUserA(request(app).get(`/api/band-events/${created.body.id}`)).expect(404)
  })

  it('never leaks another tenant\'s members, slots or events', async () => {
    const eventA = await addEvent(seed.tenantA.id, 'Alpha shoot', '2027-09-10')
    const eventB = await addEvent(seed.tenantB.id, 'Beta shoot', '2027-09-10')
    await addBandSlot(seed.tenantB.id, seed.memberB.id, '2027-09-10', '2027-09-10', 'unavailable', 'Beta secret')

    const res = await asUserA(request(app).get(`/api/band-events/${eventA.id}`)).expect(200)

    expect(res.body.members_availability.map((m) => m.member_id)).toEqual([seed.memberA.id])
    expect(JSON.stringify(res.body)).not.toContain('Beta secret')

    // Existence must not leak: the other tenant's event is a 404, not a 403.
    await asUserA(request(app).get(`/api/band-events/${eventB.id}`)).expect(404)
  })

  it('exposes a multi-day summary for the create-event availability check', async () => {
    await addBandSlot(seed.tenantA.id, seed.memberA.id, '2027-09-11', '2027-09-11', 'unavailable', 'Dentist')

    const res = await asUserA(request(app).get('/api/availability/span').query({
      from: SPAN.start,
      to: SPAN.end,
    })).expect(200)

    expect(res.body.members.find((member) => member.member_id === seed.memberA.id)).toMatchObject({
      status: 'unavailable', reason: 'Dentist',
    })
    expect(res.body.days).toHaveLength(3)
  })

  it('defaults a newly created event to lead members and hides unselected members', async () => {
    const { rows: [optional] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order)
       VALUES ($1, 'Optional Player', 'optional', 2) RETURNING *`,
      [seed.tenantA.id],
    )
    await addBandSlot(seed.tenantA.id, optional.id, SPAN.start, SPAN.start, 'unavailable', 'Private conflict')

    const created = await asUserA(request(app).post('/api/band-events').send({
      title: 'Press day', start_date: SPAN.start, end_date: SPAN.end,
    })).expect(201)
    const detail = await asUserA(request(app).get(`/api/band-events/${created.body.id}`)).expect(200)

    expect(detail.body.members_availability.map((member) => member.member_id)).toEqual([seed.memberA.id])
    expect(JSON.stringify(detail.body)).not.toContain('Private conflict')
  })

  it('adds and removes an event member explicitly', async () => {
    const event = await addEvent(seed.tenantA.id, 'Video shoot', SPAN.start)
    const { rows: [optional] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order)
       VALUES ($1, 'Camera Assistant', 'optional', 2) RETURNING *`,
      [seed.tenantA.id],
    )

    const added = await asUserA(request(app)
      .post(`/api/band-events/${event.id}/participants`)
      .send({ band_member_id: optional.id })).expect(201)
    expect(memberEntry(added.body, optional.id)).toMatchObject({ name: 'Camera Assistant' })

    await asUserA(request(app)
      .delete(`/api/band-events/${event.id}/participants/${optional.id}`)).expect(204)
    const detail = await asUserA(request(app).get(`/api/band-events/${event.id}`)).expect(200)
    expect(memberEntry(detail.body, optional.id)).toBeUndefined()
  })

  it('returns 404 when adding a member from another tenant', async () => {
    const event = await addEvent(seed.tenantA.id, 'Alpha event', SPAN.start)

    await asUserA(request(app)
      .post(`/api/band-events/${event.id}/participants`)
      .send({ band_member_id: seed.memberB.id })).expect(404)
  })
})
