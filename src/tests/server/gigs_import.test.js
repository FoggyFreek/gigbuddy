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

const validRow = {
  event_date: '2027-03-15',
  event_description: 'Imported Show',
}

describe('POST /api/gigs/import — basic', () => {
  it('rejects empty array', async () => {
    await asUserA(request(app).post('/api/gigs/import').send([])).expect(400)
  })

  it('rejects array over 200', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      event_date: '2027-01-01',
      event_description: `Show ${i}`,
    }))
    await asUserA(request(app).post('/api/gigs/import').send(rows)).expect(400)
  })

  it('creates gigs for the active tenant', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs/import').send([validRow]),
    ).expect(201)
    expect(res.body.created).toBe(1)
    expect(res.body.skipped).toBe(0)
    const { rows } = await pool.query(
      `SELECT tenant_id, event_date::text, event_description FROM gigs
       WHERE event_description = 'Imported Show'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].tenant_id).toBe(seed.tenantA.id)
    expect(rows[0].event_date.slice(0, 10)).toBe('2027-03-15')
  })

  it('persists event_link, ticket_link and admission', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{
        ...validRow,
        event_link: 'https://stream.example.com',
        ticket_link: 'https://tickets.example.com',
        admission: 'paid',
      }]),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT event_link, ticket_link, admission FROM gigs
       WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows[0].event_link).toBe('https://stream.example.com')
    expect(rows[0].ticket_link).toBe('https://tickets.example.com')
    expect(rows[0].admission).toBe('paid')
  })

  it('auto-adds lead participants', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs/import').send([validRow]),
    ).expect(201)
    const { rows: inserted } = await pool.query(
      `SELECT * FROM gigs WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    const gigId = inserted[0].id
    const { rows: participants } = await pool.query(
      `SELECT band_member_id FROM gig_participants WHERE gig_id = $1 AND tenant_id = $2`,
      [gigId, seed.tenantA.id],
    )
    expect(participants).toHaveLength(1)
    expect(participants[0].band_member_id).toBe(seed.memberA.id)
    // also confirm created count
    expect(res.body.created).toBe(1)
  })

  it('skips rows missing event_date', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs/import').send([
        { event_description: 'No Date' },
        validRow,
      ]),
    ).expect(201)
    expect(res.body.created).toBe(1)
    expect(res.body.skipped).toBe(1)
  })

  it('skips rows missing event_description', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs/import').send([
        { event_date: '2027-05-01' },
        validRow,
      ]),
    ).expect(201)
    expect(res.body.created).toBe(1)
    expect(res.body.skipped).toBe(1)
  })
})

describe('POST /api/gigs/import — status', () => {
  it('omitted status defaults to confirmed', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([validRow]),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT status FROM gigs WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows[0].status).toBe('confirmed')
  })

  it('accepts valid status values', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, status: 'option' }]),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT status FROM gigs WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows[0].status).toBe('option')
  })

  it('rejects invalid status', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, status: 'maybe' }]),
    ).expect(400)
  })
})

describe('POST /api/gigs/import — date/time validation', () => {
  it('rejects malformed event_date', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, event_date: 'not-a-date' }]),
    ).expect(400)
  })

  it('rejects malformed start_time', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, start_time: 'bad' }]),
    ).expect(400)
  })

  it('rejects malformed end_time', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, end_time: '25:99' }]),
    ).expect(400)
  })

  it('accepts valid time values', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{
        ...validRow,
        start_time: '20:00',
        end_time: '22:30',
      }]),
    ).expect(201)
  })
})

describe('POST /api/gigs/import — venue/festival validation', () => {
  it('rejects malformed venue_id', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, venue_id: 'abc' }]),
    ).expect(400)
  })

  it('rejects malformed festival_id', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, festival_id: 'xyz' }]),
    ).expect(400)
  })

  it('accepts null venue_id and festival_id', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([{
        ...validRow, venue_id: null, festival_id: null,
      }]),
    ).expect(201)
  })

  it('accepts a valid venue_id belonging to the same tenant', async () => {
    const venueA = seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, venue_id: venueA.id }]),
    ).expect(201)
    const { rows } = await pool.query(
      `SELECT venue_id FROM gigs WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows[0].venue_id).toBe(venueA.id)
  })

  it('rejects a venue_id belonging to another tenant (cross-tenant isolation)', async () => {
    const venueB = seed.venues.find((v) => v.tenant_id === seed.tenantB.id)
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, venue_id: venueB.id }]),
    ).expect(400)
  })

  it('rejects a festival_id belonging to another tenant', async () => {
    const venueB = seed.venues.find((v) => v.tenant_id === seed.tenantB.id)
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, festival_id: venueB.id }]),
    ).expect(400)
  })

  it('rejects venue_id pointing to a festival-category row (wrong category)', async () => {
    const { rows: [festival] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'festival', 'Test Fest')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, venue_id: festival.id }]),
    ).expect(400)
  })

  it('rejects festival_id pointing to a venue-category row (wrong category)', async () => {
    const venueA = seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
    await asUserA(
      request(app).post('/api/gigs/import').send([{ ...validRow, festival_id: venueA.id }]),
    ).expect(400)
  })
})

describe('POST /api/gigs/import — tenant isolation', () => {
  it('gigs created belong only to the requesting tenant', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([validRow, { ...validRow, event_date: '2027-04-01' }]),
    ).expect(201)
    const { rows: tenantBGigs } = await pool.query(
      `SELECT id FROM gigs WHERE event_description = 'Imported Show' AND tenant_id = $1`,
      [seed.tenantB.id],
    )
    expect(tenantBGigs).toHaveLength(0)
  })

  it('tenant B request does not see tenant A gigs created', async () => {
    await asUserA(
      request(app).post('/api/gigs/import').send([validRow]),
    ).expect(201)
    const resB = await asUserB(
      request(app).get('/api/gigs/'),
    ).expect(200)
    expect(resB.body.every((g) => g.event_description !== 'Imported Show')).toBe(true)
  })
})
