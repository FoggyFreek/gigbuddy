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

describe('GET /api/gigs/map', () => {
  it('returns only the minimal tenant-scoped gig-map projection in the requested past window', async () => {
    const venueA = seed.venues.find((venue) => venue.tenant_id === seed.tenantA.id)
    await pool.query(
      `UPDATE venues
          SET city = 'Utrecht', region = 'UT', country = 'NL', latitude = 52.09, longitude = 5.12
        WHERE id = $1`,
      [venueA.id],
    )
    await pool.query(
      `UPDATE gigs SET event_date = '2000-01-01', venue_id = $1 WHERE id = $2`,
      [venueA.id, seed.gigA.id],
    )
    await pool.query(`UPDATE gigs SET event_date = '2000-01-01' WHERE id = $1`, [seed.gigB.id])
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2000-01-02', 'Upper boundary'), ($1, '2999-01-01', 'Future')`,
      [seed.tenantA.id],
    )

    const res = await asUserA(
      request(app).get('/api/gigs/map').query({ from: '2000-01-01', to: '2000-01-02' }),
    ).expect(200)

    expect(res.body.meta).toEqual({ from: '2000-01-01', to: '2000-01-02', returned: 2 })
    expect(res.body.items.map((gig) => gig.event_description)).toEqual(['Alpha Gig', 'Upper boundary'])
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'event_date', 'event_description', 'festival', 'id', 'venue',
    ])
    expect(res.body.items[0].venue).toEqual({
      id: venueA.id,
      city: 'Utrecht',
      region: 'UT',
      country: 'NL',
      latitude: 52.09,
      longitude: 5.12,
    })
    expect(res.body.items.every((gig) => gig.event_description !== 'Beta Gig')).toBe(true)
  })

  it('rejects an unscoped or malformed date window', async () => {
    await asUserA(request(app).get('/api/gigs/map')).expect(400)
    await asUserA(
      request(app).get('/api/gigs/map').query({ from: '2026-02-30', to: '2026-01-01' }),
    ).expect(400)
  })
})

describe('POST /api/venues/import coordinates', () => {
  it('persists mapped latitude and longitude without exposing them in venue forms', async () => {
    const res = await asUserA(request(app).post('/api/venues/import')).send([{
      name: 'Paradiso',
      city: 'Amsterdam',
      country: 'NL',
      latitude: '52.3622',
      longitude: '4.8838',
    }]).expect(200)

    expect(res.body).toEqual({ imported: 1, skipped: 0 })
    const { rows: [venue] } = await pool.query(
      `SELECT latitude, longitude FROM venues WHERE tenant_id = $1 AND name = 'Paradiso'`,
      [seed.tenantA.id],
    )
    expect(venue).toEqual({ latitude: 52.3622, longitude: 4.8838 })
  })

  it('rejects an incomplete coordinate pair', async () => {
    const res = await asUserA(request(app).post('/api/venues/import')).send([{
      name: 'No Longitude',
      latitude: '52.1',
    }]).expect(400)

    expect(res.body.error).toMatch(/provided together/i)
  })
})
