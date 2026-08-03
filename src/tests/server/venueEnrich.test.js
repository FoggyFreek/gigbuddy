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

const venueA = () => seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
const venueB = () => seed.venues.find((v) => v.tenant_id === seed.tenantB.id)

const SUGGESTION = {
  id: 'NL/POI/p0/12345',
  name: 'Paradiso',
  street_and_number: 'Weteringschans 6',
  postal_code: '1017SG',
  city: 'Amsterdam',
  region: 'Noord-Holland',
  country: 'NL',
  website: 'https://www.paradiso.nl',
  phone: '+31 20 626 4521',
  latitude: 52.3624,
  longitude: 4.8838,
}

function enrich(venueId, suggestion = SUGGESTION) {
  return asUserA(request(app).post(`/api/venues/${venueId}/enrich`).send({ suggestion }))
}

async function clearAddress(id) {
  await pool.query(
    `UPDATE venues SET street_and_number = NULL, postal_code = NULL, city = NULL,
       region = NULL, country = NULL, website = NULL, phone = NULL,
       latitude = NULL, longitude = NULL
     WHERE id = $1`,
    [id],
  )
}

describe('POST /api/venues/:id/enrich', () => {
  it('fills every empty field and reports what it filled', async () => {
    const v = venueA()
    await clearAddress(v.id)

    const res = await enrich(v.id).expect(200)

    expect(res.body.venue).toMatchObject({
      street_and_number: 'Weteringschans 6',
      postal_code: '1017SG',
      city: 'Amsterdam',
      region: 'Noord-Holland',
      country: 'NL',
      website: 'https://www.paradiso.nl',
      phone: '+31 20 626 4521',
    })
    expect(res.body.filled.sort()).toEqual([
      'city', 'country', 'phone', 'postal_code', 'region', 'street_and_number', 'website',
    ])
  })

  it('never overwrites a field that already has a value', async () => {
    const v = venueA()
    await clearAddress(v.id)
    await pool.query(
      "UPDATE venues SET city = 'Utrecht', phone = '030 1234567' WHERE id = $1",
      [v.id],
    )

    const res = await enrich(v.id).expect(200)

    expect(res.body.venue.city).toBe('Utrecht')
    expect(res.body.venue.phone).toBe('030 1234567')
    expect(res.body.filled).not.toContain('city')
    expect(res.body.filled).not.toContain('phone')
    expect(res.body.venue.postal_code).toBe('1017SG')
  })

  it('ignores the client\'s view of what is empty and re-checks the stored row', async () => {
    const v = venueA()
    await clearAddress(v.id)
    await pool.query("UPDATE venues SET city = 'Utrecht' WHERE id = $1", [v.id])

    // A stale client could believe city is still blank; the server must not care.
    const res = await enrich(v.id).expect(200)

    expect(res.body.venue.city).toBe('Utrecht')
  })

  it('stores the coordinates when the venue has none', async () => {
    const v = venueA()
    await clearAddress(v.id)

    await enrich(v.id).expect(200)

    const { rows } = await pool.query('SELECT latitude, longitude FROM venues WHERE id = $1', [v.id])
    expect(Number(rows[0].latitude)).toBeCloseTo(52.3624, 4)
    expect(Number(rows[0].longitude)).toBeCloseTo(4.8838, 4)
  })

  it('leaves existing coordinates untouched', async () => {
    const v = venueA()
    await clearAddress(v.id)
    await pool.query('UPDATE venues SET latitude = 52.09, longitude = 5.12 WHERE id = $1', [v.id])

    await enrich(v.id).expect(200)

    const { rows } = await pool.query('SELECT latitude, longitude FROM venues WHERE id = $1', [v.id])
    expect(Number(rows[0].latitude)).toBeCloseTo(52.09, 4)
    expect(Number(rows[0].longitude)).toBeCloseTo(5.12, 4)
  })

  it('returns the same updated_at the database holds after both writes', async () => {
    const v = venueA()
    await clearAddress(v.id)

    const res = await enrich(v.id).expect(200)

    const { rows } = await pool.query('SELECT updated_at FROM venues WHERE id = $1', [v.id])
    expect(new Date(res.body.venue.updated_at).toISOString())
      .toBe(new Date(rows[0].updated_at).toISOString())
  })

  it('reports an empty fill set when the suggestion adds nothing', async () => {
    const v = venueA()
    await clearAddress(v.id)
    await enrich(v.id).expect(200)

    const res = await enrich(v.id).expect(200)

    expect(res.body.filled).toEqual([])
  })

  it('rejects an out-of-range coordinate', async () => {
    const v = venueA()
    await enrich(v.id, { ...SUGGESTION, latitude: 999 }).expect(400)
  })

  it('rejects a half coordinate pair', async () => {
    const v = venueA()
    await enrich(v.id, { ...SUGGESTION, longitude: null }).expect(400)
  })

  it('400s without a suggestion body', async () => {
    const v = venueA()
    await asUserA(request(app).post(`/api/venues/${v.id}/enrich`).send({})).expect(400)
  })

  it('does not enrich a venue from another tenant — 404, not 403', async () => {
    const other = venueB()
    await enrich(other.id).expect(404)

    // And nothing was written across the tenant boundary.
    const { rows } = await pool.query('SELECT city, latitude FROM venues WHERE id = $1', [other.id])
    expect(rows[0].city).not.toBe('Amsterdam')
    expect(rows[0].latitude).toBeNull()
  })

  it('404s for an unknown venue id', async () => {
    await enrich(999999).expect(404)
  })
})
