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
  seed = await fixtureDb.seedGigsAndTasks(seed)
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

function addEntry(gigId, body = {}) {
  return asUserA(request(app).post(`/api/gigs/${gigId}/timetable`).send(body))
}

async function addEntries(gigId, bodies) {
  const created = []
  for (const body of bodies) created.push((await addEntry(gigId, body).expect(201)).body)
  return created
}

describe('gig timetable — CRUD', () => {
  it('starts a gig with an empty timetable', async () => {
    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/timetable`)).expect(200)
    expect(res.body).toEqual([])
  })

  it('adds a line and returns it on the gig detail', async () => {
    const created = await addEntry(seed.gigA.id, {
      start_time: '19:00', end_time: '19:30', description: 'Get-in time',
    }).expect(201)
    expect(created.body).toMatchObject({
      start_time: '19:00', end_time: '19:30', description: 'Get-in time', position: 0,
    })

    const gig = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(gig.body.timetable).toEqual([expect.objectContaining({ description: 'Get-in time' })])
  })

  it('adds a blank line, which is how the UI starts one', async () => {
    const created = await addEntry(seed.gigA.id, {}).expect(201)
    expect(created.body).toMatchObject({ start_time: null, end_time: null, description: '' })
  })

  it('accepts a zero-length line and one that runs past midnight', async () => {
    const [instant, overnight] = await addEntries(seed.gigA.id, [
      { start_time: '22:00', end_time: '22:00', description: 'Stage call' },
      { start_time: '23:30', end_time: '01:00', description: 'Show' },
    ])
    expect(instant).toMatchObject({ start_time: '22:00', end_time: '22:00' })
    expect(overnight).toMatchObject({ start_time: '23:30', end_time: '01:00' })
  })

  it('appends each new line after the last one', async () => {
    const created = await addEntries(seed.gigA.id, [{}, {}, {}])
    expect(created.map((e) => e.position)).toEqual([0, 1, 2])
  })

  it('patches one field without touching the others', async () => {
    const [entry] = await addEntries(seed.gigA.id, [
      { start_time: '19:00', end_time: '19:30', description: 'Get-in time' },
    ])
    const patched = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`).send({ description: 'Load in' }),
    ).expect(200)
    expect(patched.body).toMatchObject({ start_time: '19:00', end_time: '19:30', description: 'Load in' })
  })

  it('clears a time back to empty', async () => {
    const [entry] = await addEntries(seed.gigA.id, [{ start_time: '19:00', end_time: '19:30' }])
    const patched = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`).send({ end_time: '' }),
    ).expect(200)
    expect(patched.body).toMatchObject({ start_time: '19:00', end_time: null })
  })

  it('deletes a line', async () => {
    const [entry] = await addEntries(seed.gigA.id, [{ description: 'Doors' }])
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`)).expect(204)
    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/timetable`)).expect(200)
    expect(res.body).toEqual([])
  })

  it('cascades away with the gig', async () => {
    await addEntries(seed.gigA.id, [{ description: 'Doors' }])
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}`)).expect(204)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM gig_timetable_entries')
    expect(rows[0].count).toBe(0)
  })
})

describe('gig timetable — reorder', () => {
  it('rewrites the positions to the order it is given', async () => {
    const entries = await addEntries(seed.gigA.id, [
      { description: 'Get-in' }, { description: 'Soundcheck' }, { description: 'Doors' },
    ])
    const reversed = [entries[2].id, entries[0].id, entries[1].id]
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/reorder`).send({ orderedEntryIds: reversed }),
    ).expect(204)

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/timetable`)).expect(200)
    expect(res.body.map((e) => e.description)).toEqual(['Doors', 'Get-in', 'Soundcheck'])
    expect(res.body.map((e) => e.position)).toEqual([0, 1, 2])
  })

  it('rejects an order that is not exactly the current lines', async () => {
    const entries = await addEntries(seed.gigA.id, [{}, {}])
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/reorder`).send({ orderedEntryIds: [entries[0].id] }),
    ).expect(400)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/reorder`)
        .send({ orderedEntryIds: [entries[0].id, entries[0].id] }),
    ).expect(400)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/reorder`).send({ orderedEntryIds: 'nope' }),
    ).expect(400)
  })

  it("404s a reorder of another tenant's gig", async () => {
    await asUserB(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/reorder`).send({ orderedEntryIds: [] }),
    ).expect(404)
  })
})

describe('gig timetable — validation', () => {
  it('rejects a malformed time', async () => {
    await addEntry(seed.gigA.id, { start_time: '25:00' }).expect(400)
    await addEntry(seed.gigA.id, { start_time: 'soon' }).expect(400)
    await addEntry(seed.gigA.id, { end_time: 7 }).expect(400)
  })

  it('rejects a non-string description and one over the cap', async () => {
    await addEntry(seed.gigA.id, { description: 42 }).expect(400)
    await addEntry(seed.gigA.id, { description: 'x'.repeat(501) }).expect(400)
  })

  it('rejects a patch with nothing to write', async () => {
    const [entry] = await addEntries(seed.gigA.id, [{}])
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`).send({}),
    ).expect(400)
  })

  it('caps the number of lines per gig', async () => {
    await pool.query(
      `INSERT INTO gig_timetable_entries (gig_id, tenant_id, description, position)
       SELECT $1, $2, 'line', g FROM generate_series(0, 99) AS g`,
      [seed.gigA.id, seed.tenantA.id],
    )
    await addEntry(seed.gigA.id, { description: 'one too many' }).expect(400)
  })
})

describe('gig timetable — tenant isolation', () => {
  it("404s a read of another tenant's gig timetable", async () => {
    await asUserB(request(app).get(`/api/gigs/${seed.gigA.id}/timetable`)).expect(404)
  })

  it("404s a write to another tenant's gig", async () => {
    await asUserB(
      request(app).post(`/api/gigs/${seed.gigA.id}/timetable`).send({ description: 'sneak' }),
    ).expect(404)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM gig_timetable_entries')
    expect(rows[0].count).toBe(0)
  })

  it("404s an update or delete of another tenant's line", async () => {
    const [entry] = await addEntries(seed.gigA.id, [{ description: 'Doors' }])
    await asUserB(
      request(app).patch(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`).send({ description: 'hacked' }),
    ).expect(404)
    await asUserB(request(app).delete(`/api/gigs/${seed.gigA.id}/timetable/${entry.id}`)).expect(404)

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/timetable`)).expect(200)
    expect(res.body[0].description).toBe('Doors')
  })

  it('404s a line addressed through the wrong gig in the same tenant', async () => {
    const other = await asUserA(request(app).post('/api/gigs').send({
      event_date: '2099-04-01', event_description: 'Other gig',
    })).expect(201)
    const [entry] = await addEntries(seed.gigA.id, [{ description: 'Doors' }])

    await asUserA(
      request(app).patch(`/api/gigs/${other.body.id}/timetable/${entry.id}`).send({ description: 'moved' }),
    ).expect(404)
    await asUserA(request(app).delete(`/api/gigs/${other.body.id}/timetable/${entry.id}`)).expect(404)
  })
})
