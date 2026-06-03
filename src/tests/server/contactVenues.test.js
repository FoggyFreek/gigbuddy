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

function venueA() {
  return seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
}
function venueB() {
  return seed.venues.find((v) => v.tenant_id === seed.tenantB.id)
}
function contactA() {
  return seed.contacts.find((c) => c.tenant_id === seed.tenantA.id)
}
function contactB() {
  return seed.contacts.find((c) => c.tenant_id === seed.tenantB.id)
}

// A festival is just a venues row with category='festival'; the combined list
// returns both, so we seed one in tenant A to prove the category comes through.
async function makeFestivalA(name) {
  const { rows } = await pool.query(
    `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'festival', $2) RETURNING id`,
    [seed.tenantA.id, name],
  )
  return rows[0].id
}

describe('POST /api/contacts/:id/venues — link', () => {
  it('links a venue and returns it with is_primary false', async () => {
    const res = await asUserA(
      request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id }),
    ).expect(201)
    expect(res.body.id).toBe(venueA().id)
    expect(res.body.category).toBe('venue')
    expect(res.body.is_primary).toBe(false)
  })

  it('returns 400 without a venue_id', async () => {
    await asUserA(
      request(app).post(`/api/contacts/${contactA().id}/venues`).send({}),
    ).expect(400)
  })

  it('returns 409 when the venue is already linked', async () => {
    await asUserA(
      request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id }),
    ).expect(201)
    await asUserA(
      request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id }),
    ).expect(409)
    const { rows } = await pool.query(
      'SELECT 1 FROM venue_contacts WHERE contact_id = $1 AND venue_id = $2',
      [contactA().id, venueA().id],
    )
    expect(rows).toHaveLength(1)
  })

  it('returns 404 linking from a contact in another tenant', async () => {
    await asUserA(
      request(app).post(`/api/contacts/${contactB().id}/venues`).send({ venue_id: venueA().id }),
    ).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE contact_id = $1', [contactB().id])
    expect(rows).toHaveLength(0)
  })

  it('returns 404 linking a venue from another tenant', async () => {
    await asUserA(
      request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueB().id }),
    ).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE venue_id = $1', [venueB().id])
    expect(rows).toHaveLength(0)
  })
})

describe('GET /api/contacts/:id/venues — list', () => {
  it('lists linked venues and festivals, ordered by category then name', async () => {
    const festId = await makeFestivalA('Aardvark Fest')
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id })).expect(201)
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: festId })).expect(201)

    const res = await asUserA(request(app).get(`/api/contacts/${contactA().id}/venues`)).expect(200)
    expect(res.body).toHaveLength(2)
    // ORDER BY category ASC → 'festival' before 'venue'
    expect(res.body[0].id).toBe(festId)
    expect(res.body[0].category).toBe('festival')
    expect(res.body[1].id).toBe(venueA().id)
    expect(res.body.every((r) => r.is_primary === false)).toBe(true)
  })

  it('returns 404 for a contact in another tenant (no existence leak)', async () => {
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id })).expect(201)
    // tenant B cannot see tenant A's contact at all
    await asUserB(request(app).get(`/api/contacts/${contactA().id}/venues`)).expect(404)
  })
})

describe('DELETE /api/contacts/:id/venues/:venueId — unlink', () => {
  it('removes an existing link (204) and is idempotent-404 after', async () => {
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id })).expect(201)
    await asUserA(request(app).delete(`/api/contacts/${contactA().id}/venues/${venueA().id}`)).expect(204)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE contact_id = $1', [contactA().id])
    expect(rows).toHaveLength(0)
    await asUserA(request(app).delete(`/api/contacts/${contactA().id}/venues/${venueA().id}`)).expect(404)
  })

  it('returns 404 deleting a link visible only in another tenant', async () => {
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id })).expect(201)
    await asUserB(request(app).delete(`/api/contacts/${contactA().id}/venues/${venueA().id}`)).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE contact_id = $1', [contactA().id])
    expect(rows).toHaveLength(1)
  })

  it('unlinking the primary contact leaves the venue with no primary (no reassignment)', async () => {
    await asUserA(request(app).post(`/api/contacts/${contactA().id}/venues`).send({ venue_id: venueA().id })).expect(201)
    // Make this contact the venue's primary via the venue side
    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${contactA().id}`).send({ is_primary: true })).expect(200)

    await asUserA(request(app).delete(`/api/contacts/${contactA().id}/venues/${venueA().id}`)).expect(204)

    const { rows } = await pool.query(
      'SELECT 1 FROM venue_contacts WHERE venue_id = $1 AND is_primary = true',
      [venueA().id],
    )
    expect(rows).toHaveLength(0)
  })
})
