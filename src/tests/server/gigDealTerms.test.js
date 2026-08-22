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

describe('gig deal terms — defaults', () => {
  it('starts a gig on a flat fee with no booking fee or commission', async () => {
    const { rows } = await pool.query(
      `SELECT deal_type, guarantee_variant, agency_fee_basis, agency_fee_percentage,
              agency_fee_amount_cents, commission_basis, commission_percentage,
              commission_amount_cents, breakeven_includes_venue_costs,
              subject_to_vat, vat_percentage, ticket_vat_percentage, copyright_percentage
         FROM gigs WHERE id = $1`,
      [seed.gigA.id],
    )
    expect(rows[0]).toMatchObject({
      deal_type: 'flat_fee',
      guarantee_variant: null,
      agency_fee_basis: 'none',
      commission_basis: 'none',
      breakeven_includes_venue_costs: true,
      // A performance is a taxed supply until the deal says otherwise, and
      // neither rate overrides anything until one is agreed.
      subject_to_vat: true,
      vat_percentage: null,
      ticket_vat_percentage: null,
      copyright_percentage: null,
    })
    // NUMERIC comes back as a string; the point is that it is not null.
    expect(Number(rows[0].agency_fee_percentage)).toBe(0)
    expect(Number(rows[0].commission_percentage)).toBe(0)
    expect(rows[0].agency_fee_amount_cents).toBe(0)
    expect(rows[0].commission_amount_cents).toBe(0)
  })
})

describe('PATCH /api/gigs/:id — deal terms', () => {
  it('stores a full guarantee deal', async () => {
    const res = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({
        deal_type: 'guarantee',
        guarantee_variant: 'plus',
        guaranteed_fee_cents: 100000,
        percentage_of_sales: 70,
        venue_costs_cents: 80000,
        venue_capacity: 300,
        expected_visitors: 200,
        tickets_sold: 120,
        ticket_price_net_cents: 2000,
        ticket_price_gross_cents: 2420,
        breakeven_includes_venue_costs: false,
        agency_fee_basis: 'percentage',
        agency_fee_percentage: 10,
        commission_basis: 'amount',
        commission_amount_cents: 5000,
      })
    ).expect(200)

    expect(res.body).toMatchObject({
      deal_type: 'guarantee',
      guarantee_variant: 'plus',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      venue_capacity: 300,
      expected_visitors: 200,
      tickets_sold: 120,
      ticket_price_net_cents: 2000,
      ticket_price_gross_cents: 2420,
      breakeven_includes_venue_costs: false,
      agency_fee_basis: 'percentage',
      commission_basis: 'amount',
      commission_amount_cents: 5000,
    })
    expect(Number(res.body.agency_fee_percentage)).toBe(10)
    expect(Number(res.body.percentage_of_sales)).toBe(70)
  })

  it('clears a nullable money field with null', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ venue_costs_cents: 80000 })
    ).expect(200)
    const res = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ venue_costs_cents: null })
    ).expect(200)
    expect(res.body.venue_costs_cents).toBeNull()
  })

  it.each([
    ['deal_type', 'handshake'],
    ['agency_fee_basis', 'sometimes'],
    ['commission_basis', 'maybe'],
    ['breakeven_includes_venue_costs', 'yes'],
    ['subject_to_vat', 'probably'],
  ])('rejects an out-of-vocabulary %s', async (field, value) => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ [field]: value })
    ).expect(400)
  })

  it('rejects the removed agency fee mode instead of accepting it silently', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ agency_fee_mode: 'inclusive' })
    ).expect(400)
  })

  it.each([
    [{ deal_type: 'flat_fee', guarantee_variant: 'plus' }],
    [{ deal_type: 'guarantee', guarantee_variant: null }],
  ])('rejects an invalid deal type and guarantee variant pair', async (patch) => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send(patch)
    ).expect(400)
  })

  it.each([
    ['flat_fee', 'plus'],
    ['guarantee', null],
  ])('enforces the deal type and guarantee variant pair in PostgreSQL', async (dealType, variant) => {
    await expect(
      pool.query(
        'UPDATE gigs SET deal_type = $1, guarantee_variant = $2 WHERE id = $3',
        [dealType, variant, seed.gigA.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it.each([
    ['guaranteed_fee_cents', -1],
    ['guaranteed_fee_cents', 100.5],
    ['guaranteed_fee_cents', 'lots'],
    ['venue_capacity', -5],
    ['tickets_sold', 1e12],
    ['agency_fee_percentage', 101],
    ['commission_percentage', -1],
    ['agency_fee_amount_cents', -100],
    ['vat_percentage', 101],
    ['ticket_vat_percentage', -1],
    ['copyright_percentage', 101],
  ])('rejects %s = %s', async (field, value) => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ [field]: value })
    ).expect(400)
  })

  it('rejects null on a NOT NULL deal column rather than failing in Postgres', async () => {
    // A constraint violation would surface as a 500; these must be 400s.
    for (const field of ['agency_fee_percentage', 'commission_amount_cents', 'breakeven_includes_venue_costs', 'deal_type', 'subject_to_vat']) {
      await asUserA(
        request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ [field]: null })
      ).expect(400)
    }
  })

  // VAT on the deal: the flag says whether it applies at all, the two rates are
  // overrides, so clearing one means "no rate agreed", never "no VAT".
  it('stores the deal VAT flag and all percentages', async () => {
    const res = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({
        subject_to_vat: true,
        vat_percentage: 21,
        ticket_vat_percentage: 9,
        copyright_percentage: 7.5,
      })
    ).expect(200)
    expect(res.body.subject_to_vat).toBe(true)
    expect(Number(res.body.vat_percentage)).toBe(21)
    expect(Number(res.body.ticket_vat_percentage)).toBe(9)
    expect(Number(res.body.copyright_percentage)).toBe(7.5)
  })

  it('clears a VAT rate with null while the gig stays subject to VAT', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ vat_percentage: 21 })
    ).expect(200)
    const res = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ vat_percentage: null })
    ).expect(200)
    expect(res.body.vat_percentage).toBeNull()
    expect(res.body.subject_to_vat).toBe(true)
  })

  it('clears the copyright percentage with null', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ copyright_percentage: 7.5 })
    ).expect(200)
    const res = await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ copyright_percentage: null })
    ).expect(200)
    expect(res.body.copyright_percentage).toBeNull()
  })

  it('does not leak another tenant\'s gig through a terms patch', async () => {
    await asUserB(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({
        deal_type: 'door_deal',
        guarantee_variant: null,
      })
    ).expect(404)

    const { rows } = await pool.query('SELECT deal_type FROM gigs WHERE id = $1', [seed.gigA.id])
    expect(rows[0].deal_type).toBe('flat_fee')
  })
})

describe('guaranteed_fee_cents — the renamed booking fee', () => {
  it('mirrors a write onto the legacy column while both exist', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ guaranteed_fee_cents: 123456 })
    ).expect(200)

    const { rows } = await pool.query(
      'SELECT booking_fee_cents, guaranteed_fee_cents FROM gigs WHERE id = $1',
      [seed.gigA.id],
    )
    expect(rows[0].guaranteed_fee_cents).toBe(123456)
    expect(rows[0].booking_fee_cents).toBe(123456)
  })

  it('mirrors a legacy-column write back onto the new name', async () => {
    // The previous app container still writes booking_fee_cents while this
    // deployment rolls out; the new name must not go stale behind it.
    await pool.query('UPDATE gigs SET booking_fee_cents = 77700 WHERE id = $1', [seed.gigA.id])

    const { rows } = await pool.query(
      'SELECT guaranteed_fee_cents FROM gigs WHERE id = $1',
      [seed.gigA.id],
    )
    expect(rows[0].guaranteed_fee_cents).toBe(77700)
  })

  it('mirrors on insert from either side', async () => {
    const { rows: legacy } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, status, booking_fee_cents)
       VALUES ($1, '2026-11-01', 'Legacy insert', 'confirmed', 4200)
       RETURNING booking_fee_cents, guaranteed_fee_cents`,
      [seed.tenantA.id],
    )
    expect(legacy[0].guaranteed_fee_cents).toBe(4200)

    const { rows: current } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, status, guaranteed_fee_cents)
       VALUES ($1, '2026-11-02', 'Current insert', 'confirmed', 4300)
       RETURNING booking_fee_cents, guaranteed_fee_cents`,
      [seed.tenantA.id],
    )
    expect(current[0].booking_fee_cents).toBe(4300)
  })

  it('clears both sides together', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ guaranteed_fee_cents: 5000 })
    ).expect(200)
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigA.id}`).send({ guaranteed_fee_cents: null })
    ).expect(200)

    const { rows } = await pool.query(
      'SELECT booking_fee_cents, guaranteed_fee_cents FROM gigs WHERE id = $1',
      [seed.gigA.id],
    )
    expect(rows[0].guaranteed_fee_cents).toBeNull()
    expect(rows[0].booking_fee_cents).toBeNull()
  })
})

describe('gig costs', () => {
  it('starts empty and appends in insertion order', async () => {
    const empty = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/costs`)).expect(200)
    expect(empty.body).toEqual([])

    const travel = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)
    const backline = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Backline', amount_cents: 7500 })
    ).expect(201)

    expect(travel.body).toMatchObject({ label: 'Travel', amount_cents: 12500, position: 0 })
    expect(backline.body).toMatchObject({ label: 'Backline', amount_cents: 7500, position: 1 })

    const list = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/costs`)).expect(200)
    expect(list.body.map((c) => c.label)).toEqual(['Travel', 'Backline'])
  })

  it('rides along on the gig detail so the statement needs no second fetch', async () => {
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Catering', amount_cents: 4000 })
    ).expect(201)

    const res = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}`)).expect(200)
    expect(res.body.costs).toHaveLength(1)
    expect(res.body.costs[0]).toMatchObject({ label: 'Catering', amount_cents: 4000 })
  })

  it('updates and deletes a cost line', async () => {
    const created = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)

    const patched = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}/costs/${created.body.id}`)
        .send({ label: 'Travel (van)', amount_cents: 15000 })
    ).expect(200)
    expect(patched.body).toMatchObject({ label: 'Travel (van)', amount_cents: 15000 })

    await asUserA(
      request(app).delete(`/api/gigs/${seed.gigA.id}/costs/${created.body.id}`)
    ).expect(204)

    const list = await asUserA(request(app).get(`/api/gigs/${seed.gigA.id}/costs`)).expect(200)
    expect(list.body).toEqual([])
  })

  it('rejects a blank label and a negative amount', async () => {
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: '   ', amount_cents: 100 })
    ).expect(400)
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: -1 })
    ).expect(400)
  })

  it('defaults a missing amount to zero', async () => {
    const res = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'TBC' })
    ).expect(201)
    expect(res.body.amount_cents).toBe(0)
  })

  it('defaults paid_by to artist and accepts an explicit value', async () => {
    const defaulted = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)
    expect(defaulted.body.paid_by).toBe('artist')

    const explicit = await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/costs`)
        .send({ label: 'Backline', amount_cents: 7500, paid_by: 'artist_agency' })
    ).expect(201)
    expect(explicit.body.paid_by).toBe('artist_agency')

    const patched = await asUserA(
      request(app)
        .patch(`/api/gigs/${seed.gigA.id}/costs/${defaulted.body.id}`)
        .send({ label: 'Travel', amount_cents: 12500, paid_by: 'agency' })
    ).expect(200)
    expect(patched.body.paid_by).toBe('agency')
  })

  it('rejects an invalid paid_by', async () => {
    await asUserA(
      request(app)
        .post(`/api/gigs/${seed.gigA.id}/costs`)
        .send({ label: 'Travel', amount_cents: 12500, paid_by: 'venue' })
    ).expect(400)
  })

  it('caps the number of cost lines', async () => {
    for (let i = 0; i < 50; i += 1) {
      await asUserA(
        request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: `Cost ${i}`, amount_cents: 1 })
      ).expect(201)
    }
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'One too many', amount_cents: 1 })
    ).expect(400)
  })

  it('cascades away with the gig', async () => {
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)
    await asUserA(request(app).delete(`/api/gigs/${seed.gigA.id}`)).expect(204)

    const { rows } = await pool.query('SELECT 1 FROM gig_costs WHERE gig_id = $1', [seed.gigA.id])
    expect(rows).toHaveLength(0)
  })
})

describe('gig costs — tenant isolation', () => {
  it('404s a read of another tenant\'s gig costs', async () => {
    await asUserB(request(app).get(`/api/gigs/${seed.gigA.id}/costs`)).expect(404)
  })

  it('404s a write to another tenant\'s gig', async () => {
    await asUserB(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Injected', amount_cents: 100 })
    ).expect(404)

    const { rows } = await pool.query('SELECT 1 FROM gig_costs WHERE gig_id = $1', [seed.gigA.id])
    expect(rows).toHaveLength(0)
  })

  it('404s an update or delete of another tenant\'s cost line', async () => {
    const created = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)

    await asUserB(
      request(app).patch(`/api/gigs/${seed.gigA.id}/costs/${created.body.id}`).send({ label: 'Hijacked', amount_cents: 0 })
    ).expect(404)
    await asUserB(
      request(app).delete(`/api/gigs/${seed.gigA.id}/costs/${created.body.id}`)
    ).expect(404)

    const { rows } = await pool.query('SELECT label FROM gig_costs WHERE id = $1', [created.body.id])
    expect(rows[0].label).toBe('Travel')
  })

  it('404s a cost line addressed through the wrong gig in the same tenant', async () => {
    const other = await asUserA(
      request(app).post('/api/gigs').send({ event_date: '2026-10-01', event_description: 'Other gig' })
    ).expect(201)
    const created = await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/costs`).send({ label: 'Travel', amount_cents: 12500 })
    ).expect(201)

    await asUserA(
      request(app).delete(`/api/gigs/${other.body.id}/costs/${created.body.id}`)
    ).expect(404)
  })
})
