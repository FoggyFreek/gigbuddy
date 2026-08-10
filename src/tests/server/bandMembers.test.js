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

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

describe('band member roles', () => {
  it('creates and returns roles in the requested order', async () => {
    const res = await asUserA(
      request(app).post('/api/band-members').send({
        name: 'Robin',
        roles: ['Lead Vocals', 'Lead Guitar'],
      }),
    ).expect(201)

    expect(res.body.roles).toEqual(['Lead Vocals', 'Lead Guitar'])

    const listed = await asUserA(request(app).get('/api/band-members')).expect(200)
    expect(listed.body.find((member) => member.id === res.body.id).roles)
      .toEqual(['Lead Vocals', 'Lead Guitar'])
  })

  it('rejects unknown and duplicate roles', async () => {
    await asUserA(
      request(app).post('/api/band-members').send({
        name: 'Robin',
        roles: ['Lead Vocals', 'Kazoo'],
      }),
    ).expect(400)

    await asUserA(
      request(app).patch(`/api/band-members/${seed.memberA.id}`).send({
        roles: ['Drums', 'Drums'],
      }),
    ).expect(400)
  })

  it('does not update roles for a member in another tenant', async () => {
    await asUserA(
      request(app).patch(`/api/band-members/${seed.memberB.id}`).send({
        roles: ['Drums'],
      }),
    ).expect(404)

    const { rows } = await pool.query(
      'SELECT roles FROM band_members WHERE id = $1',
      [seed.memberB.id],
    )
    expect(rows[0].roles).toEqual([])
  })
})

describe('lead participant synchronization', () => {
  async function addFutureEvents() {
    const { rows: [gig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2099-09-10', 'Future gig') RETURNING id`, [seed.tenantA.id],
    )
    const { rows: [rehearsal] } = await pool.query(
      `INSERT INTO rehearsals (tenant_id, proposed_date, status)
       VALUES ($1, '2099-09-10', 'planned') RETURNING id`, [seed.tenantA.id],
    )
    const { rows: [event] } = await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Future event', '2099-09-10', '2099-09-12') RETURNING id`, [seed.tenantA.id],
    )
    return { gig, rehearsal, event }
  }

  it('adds new/promoted leads to current events and removes them on demotion', async () => {
    const events = await addFutureEvents()
    const created = await asUserA(request(app).post('/api/band-members').send({
      name: 'Future Lead', position: 'optional', roles: [],
    })).expect(201)

    await asUserA(request(app).patch(`/api/band-members/${created.body.id}`)
      .send({ position: 'lead' })).expect(200)

    for (const [table, fk, eventId] of [
      ['gig_participants', 'gig_id', events.gig.id],
      ['rehearsal_participants', 'rehearsal_id', events.rehearsal.id],
      ['band_event_participants', 'band_event_id', events.event.id],
    ]) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM ${table} WHERE ${fk} = $1 AND band_member_id = $2`,
        [eventId, created.body.id],
      )
      expect(rowCount).toBe(1)
    }
    expect((await pool.query('SELECT status FROM rehearsals WHERE id = $1', [events.rehearsal.id])).rows[0].status)
      .toBe('option')

    await asUserA(request(app).patch(`/api/band-members/${created.body.id}`)
      .send({ position: 'sub' })).expect(200)
    const { rows: [remaining] } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM gig_participants WHERE band_member_id = $1)::int AS gigs,
         (SELECT COUNT(*) FROM rehearsal_participants WHERE band_member_id = $1)::int AS rehearsals,
         (SELECT COUNT(*) FROM band_event_participants WHERE band_member_id = $1)::int AS events`,
      [created.body.id],
    )
    expect(remaining).toEqual({ gigs: 0, rehearsals: 0, events: 0 })
  })

  it('keeps completed-event participation when deleting a member', async () => {
    const { rows: [past] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2000-01-01', 'Historic gig') RETURNING id`, [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
       VALUES ($1, $2, $3)`, [seed.tenantA.id, past.id, seed.memberA.id],
    )
    const future = await addFutureEvents()
    await pool.query(
      `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [seed.tenantA.id, future.gig.id, seed.memberA.id],
    )

    await asUserA(request(app).delete(`/api/band-members/${seed.memberA.id}`)).expect(204)

    expect((await pool.query(
      'SELECT COUNT(*)::int AS count FROM gig_participants WHERE gig_id = $1 AND band_member_id = $2',
      [past.id, seed.memberA.id],
    )).rows[0].count).toBe(1)
    expect((await pool.query(
      'SELECT COUNT(*)::int AS count FROM gig_participants WHERE gig_id = $1 AND band_member_id = $2',
      [future.gig.id, seed.memberA.id],
    )).rows[0].count).toBe(0)
    expect((await asUserA(request(app).get('/api/band-members')).expect(200)).body)
      .not.toContainEqual(expect.objectContaining({ id: seed.memberA.id }))
  })
})
