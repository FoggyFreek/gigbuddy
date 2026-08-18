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

const venueA = () => seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
const contactA = () => seed.contacts.find((c) => c.tenant_id === seed.tenantA.id)

describe('GET /api/venues — list includes primary contact name', () => {
  it('returns the primary linked contact name in primary_contact_name', async () => {
    const v = venueA()
    const c = contactA()
    await pool.query(
      `INSERT INTO venue_contacts (venue_id, contact_id, tenant_id, is_primary)
       VALUES ($1, $2, $3, true)`,
      [v.id, c.id, seed.tenantA.id],
    )

    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === v.id)
    expect(row.primary_contact_name).toBe('Alpha Contact')
  })

  it('leaves primary_contact_name null when no primary contact is linked', async () => {
    const v = venueA()
    const c = contactA()
    // linked but not primary → still null
    await pool.query(
      `INSERT INTO venue_contacts (venue_id, contact_id, tenant_id, is_primary)
       VALUES ($1, $2, $3, false)`,
      [v.id, c.id, seed.tenantA.id],
    )

    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === v.id)
    expect(row.primary_contact_name).toBeNull()
  })
})

describe('POST /api/venues — create venue', () => {
  it('creates a venue and returns 201 with the new row', async () => {
    const res = await asUserA(
      request(app).post('/api/venues').send({ name: 'New Hall', city: 'Amsterdam' })
    ).expect(201)

    expect(res.body.name).toBe('New Hall')
    expect(res.body.category).toBe('venue')
    expect(res.body.city).toBe('Amsterdam')
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
  })

  // Coordinates are not form fields, but a place lookup resolves them at create
  // time and they are worth keeping — the map then opens at street zoom.
  it('stores validated coordinates supplied by a place lookup', async () => {
    const res = await asUserA(
      request(app).post('/api/venues').send({
        name: 'Located Hall', city: 'Amsterdam', latitude: 52.3624, longitude: 4.8838,
      })
    ).expect(201)

    expect(Number(res.body.latitude)).toBeCloseTo(52.3624, 4)
    expect(Number(res.body.longitude)).toBeCloseTo(4.8838, 4)
  })

  it('leaves coordinates null when none are supplied', async () => {
    const res = await asUserA(
      request(app).post('/api/venues').send({ name: 'Unlocated Hall', city: 'Amsterdam' })
    ).expect(201)

    expect(res.body.latitude).toBeNull()
    expect(res.body.longitude).toBeNull()
  })

  it('rejects a half coordinate pair', async () => {
    await asUserA(
      request(app).post('/api/venues').send({ name: 'Half Hall', latitude: 52.3624 })
    ).expect(400)
  })

  it('rejects an out-of-range coordinate', async () => {
    await asUserA(
      request(app).post('/api/venues').send({ name: 'Bad Hall', latitude: 91, longitude: 4.8 })
    ).expect(400)
  })

  it('returns 409 (not 500) when name+city duplicates an existing venue in the same tenant', async () => {
    await asUserA(
      request(app).post('/api/venues').send({ name: 'The Garage', city: 'Utrecht' })
    ).expect(201)

    const res = await asUserA(
      request(app).post('/api/venues').send({ name: 'The Garage', city: 'Utrecht' })
    ).expect(409)

    expect(res.body.error).toBeTruthy()
  })

  it('allows the same venue name+city in two different tenants', async () => {
    await asUserA(
      request(app).post('/api/venues').send({ name: 'Shared Stage', city: 'Rotterdam' })
    ).expect(201)

    const res = await asUserB(
      request(app).post('/api/venues').send({ name: 'Shared Stage', city: 'Rotterdam' })
    ).expect(201)

    expect(res.body.name).toBe('Shared Stage')
  })

  it('stores optional registration and VAT identifiers for venues and festivals', async () => {
    const festival = await asUserA(
      request(app).post('/api/venues').send({
        category: 'festival',
        name: 'Registered Festival',
        kvk_number: ' 50048295 ',
        tax_id: 'nl001794860b34',
      })
    ).expect(201)

    expect(festival.body).toMatchObject({
      category: 'festival',
      kvk_number: '50048295',
      tax_id: 'NL001794860B34',
    })

    const updated = await asUserA(
      request(app).patch(`/api/venues/${festival.body.id}`).send({
        kvk_number: ' HRB   12345 ',
        tax_id: ' de 136695976 ',
      })
    ).expect(200)

    expect(updated.body).toMatchObject({
      kvk_number: 'HRB 12345',
      tax_id: 'DE136695976',
    })
  })

  it('does not allow one tenant to update another tenant venue identifiers', async () => {
    const venueB = seed.venues.find((venue) => venue.tenant_id === seed.tenantB.id)
    await asUserA(request(app).patch(`/api/venues/${venueB.id}`).send({
      kvk_number: '50048295',
      tax_id: 'NL001794860B34',
    })).expect(404)

    const { rows: [stored] } = await pool.query(
      'SELECT kvk_number, tax_id FROM venues WHERE id = $1',
      [venueB.id],
    )
    expect(stored).toEqual({ kvk_number: null, tax_id: null })
  })
})

describe('POST /api/venues/duplicate-check', () => {
  it('matches organization name, address, website, or email and reports every matching field', async () => {
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (
         tenant_id, name, organization_name, street_and_number, website, email
       ) VALUES ($1, 'Existing Hall', 'Existing Org', 'Main Street 10',
                 'https://example.com/', 'bookings@example.com')
       RETURNING id`,
      [seed.tenantA.id],
    )

    const res = await asUserA(request(app).post('/api/venues/duplicate-check').send({
      organization_name: ' existing org ',
      street_and_number: ' MAIN STREET 10 ',
      website: 'https://example.com',
      email: 'BOOKINGS@EXAMPLE.COM',
    })).expect(200)

    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: venue.id,
        name: 'Existing Hall',
        matched_fields: ['organization_name', 'address', 'website', 'email'],
      }),
    ])
    expect(res.body.meta).toEqual({ limit: 5, returned: 1 })
  })

  it('does not reveal matching venues from another tenant', async () => {
    const venueB = seed.venues.find((venue) => venue.tenant_id === seed.tenantB.id)
    await pool.query(
      `UPDATE venues SET organization_name = 'Private Org', email = 'private@example.com'
       WHERE id = $1`,
      [venueB.id],
    )

    const res = await asUserA(request(app).post('/api/venues/duplicate-check').send({
      organization_name: 'Private Org',
      email: 'private@example.com',
    })).expect(200)

    expect(res.body.items).toEqual([])
  })
})

describe('POST /api/venues — festival_name rejected', () => {
  it('returns 400 when festival_name is present in create body', async () => {
    const res = await asUserA(
      request(app).post('/api/venues').send({ name: 'Texel Blues', festival_name: 'Texel Blues Festival' })
    ).expect(400)
    expect(res.body.error).toMatch(/festival_name/)
  })
})

describe('PATCH /api/venues/:id — festival_name rejected', () => {
  it('returns 400 when festival_name is present in update body', async () => {
    const v = venueA()
    const res = await asUserA(
      request(app).patch(`/api/venues/${v.id}`).send({ festival_name: 'something' })
    ).expect(400)
    expect(res.body.error).toMatch(/festival_name/)
  })
})

describe('GET /api/venues/search', () => {
  it('matches festival by name (not festival_name)', async () => {
    await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city)
       VALUES ($1, 'festival', 'Texel Blues Festival', 'Den Hoorn')`,
      [seed.tenantA.id],
    )
    const res = await asUserA(
      request(app).get('/api/venues/search?q=Texel')
    ).expect(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0].name).toBe('Texel Blues Festival')
    expect(res.body[0]).not.toHaveProperty('festival_name')
  })

  it('filters by category=festival', async () => {
    await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city)
       VALUES ($1, 'festival', 'Big Outdoor Fest', 'Breda')`,
      [seed.tenantA.id],
    )
    const res = await asUserA(
      request(app).get('/api/venues/search?q=Big&category=festival')
    ).expect(200)
    expect(res.body.every((v) => v.category === 'festival')).toBe(true)
  })
})

describe('GET /api/venues — years field', () => {
  it('returns [] for a venue with no gigs', async () => {
    const v = venueA()
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === v.id)
    expect(row.years).toEqual([])
  })

  it('returns the year when a gig is linked via venue_id', async () => {
    const v = venueA()
    await pool.query('UPDATE gigs SET venue_id = $1 WHERE id = $2', [v.id, seed.gigA.id])
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === v.id)
    expect(row.years).toEqual([2026])
  })

  it('returns the year when a gig is linked via festival_id', async () => {
    const { rows: [fest] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'festival', 'Alpha Fest') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query('UPDATE gigs SET festival_id = $1 WHERE id = $2', [fest.id, seed.gigA.id])
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === fest.id)
    expect(row.years).toEqual([2026])
  })

  it('returns sorted distinct years from gigs via both venue_id and festival_id', async () => {
    const v = venueA()
    await pool.query('UPDATE gigs SET venue_id = $1 WHERE id = $2', [v.id, seed.gigA.id])
    // Insert a second gig in a different year (2024) also via venue_id
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id)
       VALUES ($1, '2024-08-15', 'Earlier Gig', $2)`,
      [seed.tenantA.id, v.id],
    )
    // Insert a third gig in same year 2026 via festival_id (duplicate year — should deduplicate)
    const { rows: [fest] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'festival', 'Dup Fest') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, festival_id)
       VALUES ($1, '2026-09-01', 'Festival Gig', $2)`,
      [seed.tenantA.id, fest.id],
    )
    // Also link that festival gig to v as venue_id — but the DISTINCT means 2026 appears once
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id)
       VALUES ($1, '2025-03-10', 'Mid Gig', $2)`,
      [seed.tenantA.id, v.id],
    )
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const row = res.body.find((r) => r.id === v.id)
    expect(row.years).toEqual([2024, 2025, 2026])
  })

  it('tenant A response does not contain tenant B venues', async () => {
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    const ids = res.body.map((r) => r.tenant_id)
    expect(ids.every((tid) => tid === seed.tenantA.id)).toBe(true)
  })
})

describe('PATCH venue category — server enforces invariant', () => {
  it('rejects category change without on_affected_gigs when gig references exist', async () => {
    const v = venueA()
    await pool.query(
      'UPDATE gigs SET venue_id = $1 WHERE id = $2',
      [v.id, seed.gigA.id],
    )

    const res = await asUserA(
      request(app).patch(`/api/venues/${v.id}`).send({ category: 'festival' })
    ).expect(409)

    expect(res.body.error).toMatch(/affects gigs/i)
    expect(res.body.affected_gigs).toHaveLength(1)
    expect(res.body.affected_gigs[0].id).toBe(seed.gigA.id)

    const { rows } = await pool.query('SELECT category FROM venues WHERE id = $1', [v.id])
    expect(rows[0].category).toBe('venue')
  })

  it('allows category change without on_affected_gigs when no gigs reference the venue', async () => {
    const v = venueA()
    const res = await asUserA(
      request(app).patch(`/api/venues/${v.id}`).send({ category: 'festival' })
    ).expect(200)
    expect(res.body.category).toBe('festival')
  })

  it('category change with on_affected_gigs=remove clears gig venue_id', async () => {
    const v = venueA()
    await pool.query('UPDATE gigs SET venue_id = $1 WHERE id = $2', [v.id, seed.gigA.id])

    await asUserA(
      request(app).patch(`/api/venues/${v.id}`).send({ category: 'festival', on_affected_gigs: 'remove' })
    ).expect(200)

    const { rows } = await pool.query('SELECT venue_id, festival_id FROM gigs WHERE id = $1', [seed.gigA.id])
    expect(rows[0].venue_id).toBeNull()
    expect(rows[0].festival_id).toBeNull()
  })

  it('category change with on_affected_gigs=migrate moves venue_id to festival_id', async () => {
    const v = venueA()
    await pool.query('UPDATE gigs SET venue_id = $1 WHERE id = $2', [v.id, seed.gigA.id])

    await asUserA(
      request(app).patch(`/api/venues/${v.id}`).send({ category: 'festival', on_affected_gigs: 'migrate' })
    ).expect(200)

    const { rows } = await pool.query('SELECT venue_id, festival_id FROM gigs WHERE id = $1', [seed.gigA.id])
    expect(rows[0].venue_id).toBeNull()
    expect(rows[0].festival_id).toBe(v.id)
  })
})

describe('GET /api/venues/:id/events — the venue event history', () => {
  async function addGig(venueId, { date, description, column = 'venue_id', tenantId = seed.tenantA.id }) {
    const { rows: [gig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, ${column})
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, date, description, venueId],
    )
    return gig
  }

  it('returns the venue gigs newest first, in the bounded envelope', async () => {
    const v = venueA()
    await pool.query('DELETE FROM gigs WHERE tenant_id = $1', [seed.tenantA.id])
    await addGig(v.id, { date: '2024-08-15', description: 'Older' })
    await addGig(v.id, { date: '2026-05-01', description: 'Newer' })

    const res = await asUserA(request(app).get(`/api/venues/${v.id}/events`)).expect(200)

    expect(res.body.items.map((g) => g.event_description)).toEqual(['Newer', 'Older'])
    expect(res.body.meta.returned).toBe(2)
    expect(res.body.meta.limit).toBe(10)
    expect(res.body.meta.nextCursor).toBeNull()
  })

  it('includes gigs linked through festival_id as well as venue_id', async () => {
    const v = venueA()
    await pool.query('DELETE FROM gigs WHERE tenant_id = $1', [seed.tenantA.id])
    await addGig(v.id, { date: '2025-01-02', description: 'As festival', column: 'festival_id' })

    const res = await asUserA(request(app).get(`/api/venues/${v.id}/events`)).expect(200)
    expect(res.body.items.map((g) => g.event_description)).toEqual(['As festival'])
  })

  it('pages with the keyset cursor rather than an offset', async () => {
    const v = venueA()
    await pool.query('DELETE FROM gigs WHERE tenant_id = $1', [seed.tenantA.id])
    await addGig(v.id, { date: '2024-01-01', description: 'Third' })
    await addGig(v.id, { date: '2025-01-01', description: 'Second' })
    await addGig(v.id, { date: '2026-01-01', description: 'First' })

    const page1 = await asUserA(request(app).get(`/api/venues/${v.id}/events?limit=2`)).expect(200)
    expect(page1.body.items.map((g) => g.event_description)).toEqual(['First', 'Second'])
    const { date, id } = page1.body.meta.nextCursor

    const page2 = await asUserA(
      request(app).get(`/api/venues/${v.id}/events?limit=2&cursorDate=${date.slice(0, 10)}&cursorId=${id}`)
    ).expect(200)
    expect(page2.body.items.map((g) => g.event_description)).toEqual(['Third'])
    expect(page2.body.meta.nextCursor).toBeNull()
  })

  it('rejects a malformed limit and a half-supplied cursor', async () => {
    const v = venueA()
    await asUserA(request(app).get(`/api/venues/${v.id}/events?limit=0`)).expect(400)
    await asUserA(request(app).get(`/api/venues/${v.id}/events?limit=abc`)).expect(400)
    await asUserA(request(app).get(`/api/venues/${v.id}/events?cursorId=5`)).expect(400)
  })

  it('never leaks another tenant\'s gigs at a same-named venue', async () => {
    const v = venueA()
    const venueB = seed.venues.find((venue) => venue.tenant_id === seed.tenantB.id)
    await pool.query('DELETE FROM gigs WHERE tenant_id = ANY($1)', [[seed.tenantA.id, seed.tenantB.id]])
    await addGig(venueB.id, { date: '2026-02-02', description: 'Bravo only', tenantId: seed.tenantB.id })

    const res = await asUserA(request(app).get(`/api/venues/${v.id}/events`)).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('404s for a venue belonging to another tenant', async () => {
    const venueB = seed.venues.find((venue) => venue.tenant_id === seed.tenantB.id)
    await asUserA(request(app).get(`/api/venues/${venueB.id}/events`)).expect(404)
  })
})
