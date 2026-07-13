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

describe('gig admission — defaults', () => {
  it('seeded gig defaults to admission=free', async () => {
    const { rows } = await pool.query(
      'SELECT admission, ticket_link FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].admission).toBe('free')
    expect(rows[0].ticket_link).toBeNull()
  })

  it('POST /api/gigs creates gig with admission=free by default', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-10-01',
        event_description: 'New Show',
      })
    ).expect(201)
    const { rows } = await pool.query(
      'SELECT admission FROM gigs WHERE id = $1',
      [res.body.id]
    )
    expect(rows[0].admission).toBe('free')
  })
})

describe('gig admission — PATCH', () => {
  it('PATCH admission=paid persists to DB', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ admission: 'paid' })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT admission FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].admission).toBe('paid')
  })

  it('PATCH ticket_link persists to DB', async () => {
    const url = 'https://tickets.example.com/event/123'
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ ticket_link: url })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT ticket_link FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].ticket_link).toBe(url)
  })

  it('PATCH can set admission=paid and ticket_link together', async () => {
    const url = 'https://tickets.example.com/event/456'
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ admission: 'paid', ticket_link: url })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT admission, ticket_link FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].admission).toBe('paid')
    expect(rows[0].ticket_link).toBe(url)
  })

  it('PATCH ticket_link=null clears the field', async () => {
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ admission: 'paid', ticket_link: 'https://tickets.example.com' })
    ).expect(200)
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ admission: 'free', ticket_link: null })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT admission, ticket_link FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].admission).toBe('free')
    expect(rows[0].ticket_link).toBeNull()
  })
})

describe('gig admission — GET response', () => {
  it('GET /api/gigs/:id includes admission and ticket_link', async () => {
    const url = 'https://tickets.example.com'
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ admission: 'paid', ticket_link: url })
    ).expect(200)
    const res = await asUserA(
      request(app).get(`/api/gigs/${seed.gigA.id}`)
    ).expect(200)
    expect(res.body.admission).toBe('paid')
    expect(res.body.ticket_link).toBe(url)
  })

  it('GET /api/gigs list includes admission field', async () => {
    const res = await asUserA(request(app).get('/api/gigs')).expect(200)
    expect(res.body[0]).toHaveProperty('admission', 'free')
  })
})

describe('gig admission — tenant isolation', () => {
  it('PATCH admission on foreign-tenant gig → 404, DB unchanged', async () => {
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigB.id}`)
        .send({ admission: 'paid' })
    ).expect(404)
    const { rows } = await pool.query(
      'SELECT admission FROM gigs WHERE id = $1',
      [seed.gigB.id]
    )
    expect(rows[0].admission).toBe('free')
  })
})

describe('gig deal terms — merchandise_cut & percentage_of_sales', () => {
  it('PATCH persists both percentages to DB', async () => {
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ merchandise_cut: 15, percentage_of_sales: '20.5' })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT merchandise_cut, percentage_of_sales FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(Number(rows[0].merchandise_cut)).toBe(15)
    expect(Number(rows[0].percentage_of_sales)).toBe(20.5)
  })

  it('PATCH null clears a percentage field', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ merchandise_cut: 10 })
    ).expect(200)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ merchandise_cut: null })
    ).expect(200)
    const { rows } = await pool.query(
      'SELECT merchandise_cut FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].merchandise_cut).toBeNull()
  })

  it('PATCH rejects out-of-range and non-numeric percentages → 400, DB unchanged', async () => {
    for (const bad of [150, -10, 'abc', '', '   ']) {
      await asUserA(
        request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ merchandise_cut: bad })
      ).expect(400)
    }
    const { rows } = await pool.query(
      'SELECT merchandise_cut FROM gigs WHERE id = $1',
      [seed.gigA.id]
    )
    expect(rows[0].merchandise_cut).toBeNull()
  })

  it('PATCH percentages on foreign-tenant gig → 404, DB unchanged', async () => {
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigB.id}`)
        .send({ merchandise_cut: 25 })
    ).expect(404)
    const { rows } = await pool.query(
      'SELECT merchandise_cut FROM gigs WHERE id = $1',
      [seed.gigB.id]
    )
    expect(rows[0].merchandise_cut).toBeNull()
  })

  it('GET /api/gigs/:id includes both deal-term fields', async () => {
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ merchandise_cut: 12.5, percentage_of_sales: 30 })
    ).expect(200)
    const res = await asUserA(
      request(app).get(`/api/gigs/${seed.gigA.id}`)
    ).expect(200)
    expect(Number(res.body.merchandise_cut)).toBe(12.5)
    expect(Number(res.body.percentage_of_sales)).toBe(30)
  })
})

describe('gig festival_id — venue category validation', () => {
  async function insertVenue(tenantId, category, name) {
    const { rows } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, category, name],
    )
    return rows[0].id
  }

  it('POST rejects festival_id pointing to a venue row', async () => {
    const venueId = await insertVenue(seed.tenantA.id, 'venue', 'Normal Hall')
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Festival Test',
        festival_id: venueId,
      })
    )
    expect(res.status).toBe(400)
    const { rows } = await pool.query(
      `SELECT id FROM gigs WHERE event_description = 'Festival Test' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('POST rejects venue_id pointing to a festival row', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, 'festival', 'Big Festival')
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Festival Test',
        venue_id: festivalId,
      })
    )
    expect(res.status).toBe(400)
    const { rows } = await pool.query(
      `SELECT id FROM gigs WHERE event_description = 'Festival Test' AND tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('POST creates gig with only festival_id', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, 'festival', 'Big Festival')
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Festival Show',
        festival_id: festivalId,
      })
    ).expect(201)
    expect(res.body.festival_id).toBe(festivalId)
    expect(res.body.venue_id).toBeNull()
    expect(res.body.festival).toMatchObject({ id: festivalId, category: 'festival' })
  })

  it('POST creates gig with both festival_id and venue_id', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, 'festival', 'Texel Blues')
    const venueId = await insertVenue(seed.tenantA.id, 'venue', 'Café De Zwaan')
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Festival + Venue',
        festival_id: festivalId,
        venue_id: venueId,
      })
    ).expect(201)
    expect(res.body.festival_id).toBe(festivalId)
    expect(res.body.venue_id).toBe(venueId)
    expect(res.body.festival).toMatchObject({ id: festivalId })
    expect(res.body.venue).toMatchObject({ id: venueId })
  })

  it('PATCH rejects festival_id pointing to a venue row', async () => {
    const venueId = await insertVenue(seed.tenantA.id, 'venue', 'Normal Hall')
    const res = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ festival_id: venueId })
    )
    expect(res.status).toBe(400)
    const { rows } = await pool.query(
      'SELECT festival_id FROM gigs WHERE id = $1',
      [seed.gigA.id],
    )
    expect(rows[0].festival_id).toBeNull()
  })

  it('PATCH sets festival_id on existing gig', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, 'festival', 'Test Fest')
    const res = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ festival_id: festivalId })
    ).expect(200)
    expect(res.body.festival_id).toBe(festivalId)
    expect(res.body.festival).toMatchObject({ id: festivalId, category: 'festival' })
  })

  it('GET /api/gigs includes festival field (null when unset)', async () => {
    const res = await asUserA(request(app).get('/api/gigs')).expect(200)
    const gig = res.body.find((g) => g.id === seed.gigA.id)
    expect(gig).toHaveProperty('festival', null)
  })

  it('GET /api/gigs/:id includes festival field', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, 'festival', 'Annual Fest')
    await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}`)
        .send({ festival_id: festivalId })
    ).expect(200)
    const res = await asUserA(
      request(app).get(`/api/gigs/${seed.gigA.id}`)
    ).expect(200)
    expect(res.body.festival).toMatchObject({ id: festivalId, category: 'festival' })
  })

  it('festival_id from foreign tenant is rejected', async () => {
    const betaFestivalId = await insertVenue(seed.tenantB.id, 'festival', 'Beta Fest')
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Cross-tenant attempt',
        festival_id: betaFestivalId,
      })
    )
    expect(res.status).toBe(400)
    const { rows } = await pool.query(
      `SELECT id FROM gigs WHERE event_description = 'Cross-tenant attempt'`,
    )
    expect(rows).toHaveLength(0)
  })
})

describe('gig task assignment — assigned_to normalization', () => {
  function taskA() {
    return seed.tasks.find((t) => t.tenant_id === seed.tenantA.id)
  }

  it('PATCH normalizes a numeric-string assigned_to and persists the integer', async () => {
    const res = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}/tasks/${taskA().id}`)
        .send({ assigned_to: String(seed.memberA.id) }),
    )
    expect(res.status).toBe(200)
    expect(res.body.assigned_to).toBe(seed.memberA.id)
    const { rows } = await pool.query('SELECT assigned_to FROM gig_tasks WHERE id = $1', [taskA().id])
    expect(rows[0].assigned_to).toBe(seed.memberA.id)
  })

  it('PATCH rejects a cross-tenant assigned_to with 404 and leaves it unchanged', async () => {
    const res = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}/tasks/${taskA().id}`)
        .send({ assigned_to: seed.memberB.id }),
    )
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/assigned_to/i)
    const { rows } = await pool.query('SELECT assigned_to FROM gig_tasks WHERE id = $1', [taskA().id])
    expect(rows[0].assigned_to).toBeNull()
  })

  it('POST persists assigned_to set at creation time', async () => {
    const res = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/tasks`)
        .send({ title: 'New task', assigned_to: seed.memberA.id }),
    ).expect(201)
    expect(res.body.assigned_to).toBe(seed.memberA.id)
    const { rows } = await pool.query('SELECT assigned_to FROM gig_tasks WHERE id = $1', [res.body.id])
    expect(rows[0].assigned_to).toBe(seed.memberA.id)
  })
})

describe('gig search', () => {
  const descriptions = (res) => res.body.map((g) => g.event_description)

  async function addVenueGig(tenantId, { category, name, city, event_description }) {
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, category, name, city],
    )
    const refColumn = category === 'festival' ? 'festival_id' : 'venue_id'
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, ${refColumn})
       VALUES ($1, '2026-09-01', $2, $3)`,
      [tenantId, event_description, venue.id],
    )
  }

  it('matches on the event name', async () => {
    const res = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Alpha' })).expect(200)
    expect(descriptions(res)).toContain('Alpha Gig')
  })

  it('matches on a linked gig tag', async () => {
    await asUserA(
      request(app).put(`/api/gigs/${seed.gigA.id}/tags`).send({ tags: ['Summer Tour'] }),
    ).expect(200)

    const res = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Summer' })).expect(200)
    expect(descriptions(res)).toContain('Alpha Gig')
    expect(res.body[0].tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Summer Tour' }),
    ]))
  })

  it('matches on the linked venue name and city', async () => {
    await addVenueGig(seed.tenantA.id, {
      category: 'venue', name: 'The Roxy', city: 'Antwerp', event_description: 'Mystery Show',
    })
    const byName = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Roxy' })).expect(200)
    expect(descriptions(byName)).toContain('Mystery Show')
    const byCity = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Antwerp' })).expect(200)
    expect(descriptions(byCity)).toContain('Mystery Show')
  })

  it('matches on the linked festival name and city', async () => {
    await addVenueGig(seed.tenantA.id, {
      category: 'festival', name: 'Rock Werchter', city: 'Leuven', event_description: 'Festival Slot',
    })
    const byName = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Rock' })).expect(200)
    expect(descriptions(byName)).toContain('Festival Slot')
    const byCity = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Leuven' })).expect(200)
    expect(descriptions(byCity)).toContain('Festival Slot')
  })

  it('returns nothing for queries shorter than 3 characters', async () => {
    const res = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Al' })).expect(200)
    expect(res.body).toEqual([])
  })

  it('isolates tenants: userA cannot find tenant B gigs by name or venue city', async () => {
    // Event name belonging to tenant B.
    const byName = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Beta' })).expect(200)
    expect(byName.body).toEqual([])

    // Venue city belonging to tenant B must not leak to tenant A.
    await addVenueGig(seed.tenantB.id, {
      category: 'venue', name: 'Secret Club', city: 'Rotterdam', event_description: 'Hidden Show',
    })
    const byCity = await asUserA(request(app).get('/api/gigs/search').query({ q: 'Rotterdam' })).expect(200)
    expect(byCity.body).toEqual([])
  })
})

describe('gig tags', () => {
  it('find-or-creates tags case-insensitively and includes them in gig payloads', async () => {
    const setRes = await asUserA(
      request(app).put(`/api/gigs/${seed.gigA.id}/tags`).send({
        tags: ['Summer Tour', 'Festivals', 'summer tour'],
      }),
    ).expect(200)

    expect(setRes.body.map((tag) => tag.name).sort()).toEqual(['Festivals', 'Summer Tour'])

    const detail = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(detail.body.tags.map((tag) => tag.name).sort()).toEqual(['Festivals', 'Summer Tour'])

    const list = await asUserA(request(app).get('/api/gigs')).expect(200)
    expect(list.body.find((gig) => gig.id === seed.gigA.id).tags).toEqual(detail.body.tags)

    const { rows } = await pool.query('SELECT id FROM gig_tags WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows).toHaveLength(2)
  })

  it('searches previously used tags while typing, including unlinked tags', async () => {
    await asUserA(
      request(app).put(`/api/gigs/${seed.gigA.id}/tags`).send({ tags: ['Northern Tour'] }),
    ).expect(200)
    await asUserA(
      request(app).put(`/api/gigs/${seed.gigA.id}/tags`).send({ tags: [] }),
    ).expect(200)

    const res = await asUserA(request(app).get('/api/gigs/tags').query({ q: 'north' })).expect(200)
    expect(res.body).toEqual([expect.objectContaining({ name: 'Northern Tour' })])
  })

  it('isolates tag reads and gig writes by tenant', async () => {
    await pool.query(
      'INSERT INTO gig_tags (tenant_id, name) VALUES ($1, $2)',
      [seed.tenantB.id, 'Secret Tour'],
    )

    const suggestions = await asUserA(request(app).get('/api/gigs/tags').query({ q: 'Secret' })).expect(200)
    expect(suggestions.body).toEqual([])

    await asUserA(
      request(app).put(`/api/gigs/${seed.gigB.id}/tags`).send({ tags: ['Leaked'] }),
    ).expect(404)
  })
})

describe('gig payload — venue/festival address for the location map', () => {
  async function insertVenue(tenantId, { category, name, city, street }) {
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city, street_and_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, category, name, city, street],
    )
    return venue.id
  }

  it('includes venue.street_and_number in the single-gig payload', async () => {
    const venueId = await insertVenue(seed.tenantA.id, {
      category: 'venue', name: 'Bimhuis', city: 'Amsterdam', street: 'Piet Heinkade 3',
    })
    await asUserA(request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ venue_id: venueId })).expect(200)

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(res.body.venue).toMatchObject({
      city: 'Amsterdam',
      street_and_number: 'Piet Heinkade 3',
    })
  })

  it('includes festival.street_and_number in the single-gig payload', async () => {
    const festivalId = await insertVenue(seed.tenantA.id, {
      category: 'festival', name: 'Pinkpop', city: 'Landgraaf', street: 'Sportlaan 1',
    })
    await asUserA(request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ festival_id: festivalId })).expect(200)

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(res.body.festival).toMatchObject({
      city: 'Landgraaf',
      street_and_number: 'Sportlaan 1',
    })
  })
})

describe('gig merch summary — GET /api/gigs/:id/merch-summary', () => {
  async function insertProduct(tenantId) {
    const { rows } = await pool.query(
      `INSERT INTO products (tenant_id, name) VALUES ($1, 'Tee') RETURNING id`,
      [tenantId],
    )
    return rows[0].id
  }

  async function insertSale(tenantId, productId, { gigId = null, quantity, unitPriceInclCents, vatRate, status = 'recorded' }) {
    await pool.query(
      `INSERT INTO merch_sales
         (tenant_id, product_id, gig_id, quantity, unit_price_incl_cents, vat_rate, unit_cost_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
      [tenantId, productId, gigId, quantity, unitPriceInclCents, vatRate, status],
    )
  }

  async function setRoleA(role) {
    await pool.query(
      'UPDATE memberships SET role = $1 WHERE user_id = $2 AND tenant_id = $3',
      [role, seed.userA.id, seed.tenantA.id],
    )
  }

  it('sums units and net (Excl. VAT) across VAT rates, excluding voided and non-gig sales', async () => {
    const productId = await insertProduct(seed.tenantA.id)
    // gross 2420 @21% → net 2000; gross 3270 @9% → net 3000.
    await insertSale(seed.tenantA.id, productId, { gigId: seed.gigA.id, quantity: 2, unitPriceInclCents: 1210, vatRate: 21 })
    await insertSale(seed.tenantA.id, productId, { gigId: seed.gigA.id, quantity: 3, unitPriceInclCents: 1090, vatRate: 9 })
    // Excluded: voided, and a sale not linked to the gig.
    await insertSale(seed.tenantA.id, productId, { gigId: seed.gigA.id, quantity: 5, unitPriceInclCents: 1000, vatRate: 21, status: 'voided' })
    await insertSale(seed.tenantA.id, productId, { gigId: null, quantity: 7, unitPriceInclCents: 1000, vatRate: 21 })

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/merch-summary`)).expect(200)
    expect(res.body).toEqual({ unitsSold: 5, netCents: 5000, grossCents: 5690 })
  })

  it('returns an all-zero summary for a gig with no merch', async () => {
    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/merch-summary`)).expect(200)
    expect(res.body).toEqual({ unitsSold: 0, netCents: 0, grossCents: 0 })
  })

  it('returns 404 for a foreign-tenant gig (no leak via all-zero)', async () => {
    const productId = await insertProduct(seed.tenantB.id)
    await insertSale(seed.tenantB.id, productId, { gigId: seed.gigB.id, quantity: 4, unitPriceInclCents: 1210, vatRate: 21 })
    await asUserA(request(app).get(`/api/gigs/${seed.gigB.id}/merch-summary`)).expect(404)
  })

  it('forbids readers (403) but allows contributors (200)', async () => {
    await setRoleA('reader')
    await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/merch-summary`)).expect(403)

    await setRoleA('contributor')
    await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/merch-summary`)).expect(200)
  })
})
