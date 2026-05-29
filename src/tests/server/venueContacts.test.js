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

async function makeContactA(name, category = 'press') {
  const { rows } = await pool.query(
    `INSERT INTO contacts (tenant_id, name, category) VALUES ($1, $2, $3) RETURNING id`,
    [seed.tenantA.id, name, category],
  )
  return rows[0].id
}

describe('POST /api/venues/:id/contacts — link', () => {
  it('links a contact and returns it with is_primary false', async () => {
    const res = await asUserA(
      request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id }),
    ).expect(201)
    expect(res.body.id).toBe(contactA().id)
    expect(res.body.name).toBe('Alpha Contact')
    expect(res.body.is_primary).toBe(false)
  })

  it('returns 409 when the contact is already linked', async () => {
    await asUserA(
      request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id }),
    ).expect(201)
    await asUserA(
      request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id }),
    ).expect(409)
    const { rows } = await pool.query(
      'SELECT 1 FROM venue_contacts WHERE venue_id = $1 AND contact_id = $2',
      [venueA().id, contactA().id],
    )
    expect(rows).toHaveLength(1)
  })

  it('returns 404 linking to a venue in another tenant', async () => {
    await asUserA(
      request(app).post(`/api/venues/${venueB().id}/contacts`).send({ contact_id: contactA().id }),
    ).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE venue_id = $1', [venueB().id])
    expect(rows).toHaveLength(0)
  })

  it('returns 404 linking a contact from another tenant', async () => {
    await asUserA(
      request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactB().id }),
    ).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE contact_id = $1', [contactB().id])
    expect(rows).toHaveLength(0)
  })
})

describe('GET /api/venues/:id/contacts — list', () => {
  it('lists linked contacts, primary first', async () => {
    const c2 = await makeContactA('Zeta Contact')
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id })).expect(201)
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: c2 })).expect(201)
    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${c2}`).send({ is_primary: true })).expect(200)

    const res = await asUserA(request(app).get(`/api/venues/${venueA().id}/contacts`)).expect(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].id).toBe(c2)
    expect(res.body[0].is_primary).toBe(true)
    expect(res.body[1].is_primary).toBe(false)
  })

  it('returns 404 for a venue in another tenant', async () => {
    const res = await asUserA(request(app).get(`/api/venues/${venueB().id}/contacts`)).expect(404)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/venues/:id/contacts/:contactId — primary', () => {
  it('marking a second contact primary unsets the first (one primary per venue)', async () => {
    const c2 = await makeContactA('Beta Helper')
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id })).expect(201)
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: c2 })).expect(201)

    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${contactA().id}`).send({ is_primary: true })).expect(200)
    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${c2}`).send({ is_primary: true })).expect(200)

    const { rows } = await pool.query(
      'SELECT contact_id, is_primary FROM venue_contacts WHERE venue_id = $1 ORDER BY contact_id',
      [venueA().id],
    )
    const primaries = rows.filter((r) => r.is_primary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].contact_id).toBe(c2)
  })

  it('can clear the primary flag (leaving none)', async () => {
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id })).expect(201)
    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${contactA().id}`).send({ is_primary: true })).expect(200)
    await asUserA(request(app).patch(`/api/venues/${venueA().id}/contacts/${contactA().id}`).send({ is_primary: false })).expect(200)

    const { rows } = await pool.query(
      'SELECT is_primary FROM venue_contacts WHERE venue_id = $1', [venueA().id],
    )
    expect(rows.every((r) => !r.is_primary)).toBe(true)
  })

  it('returns 404 for a link in another tenant', async () => {
    const res = await asUserA(
      request(app).patch(`/api/venues/${venueB().id}/contacts/${contactB().id}`).send({ is_primary: true }),
    ).expect(404)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/venues/:id/contacts/:contactId — unlink', () => {
  it('unlinks an existing contact', async () => {
    await asUserA(request(app).post(`/api/venues/${venueA().id}/contacts`).send({ contact_id: contactA().id })).expect(201)
    await asUserA(request(app).delete(`/api/venues/${venueA().id}/contacts/${contactA().id}`)).expect(204)
    const { rows } = await pool.query('SELECT 1 FROM venue_contacts WHERE venue_id = $1', [venueA().id])
    expect(rows).toHaveLength(0)
  })

  it('returns 404 for an unlinked contact', async () => {
    const res = await asUserA(request(app).delete(`/api/venues/${venueA().id}/contacts/${contactA().id}`)).expect(404)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/contacts/search', () => {
  it('returns [] for queries under 3 characters', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search?q=al')).expect(200)
    expect(res.body).toEqual([])
  })

  it('matches by name (case-insensitive)', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search?q=alpha')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Alpha Contact')
  })

  it('is tenant-scoped — does not return another tenant\'s contacts', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search?q=beta')).expect(200)
    expect(res.body).toHaveLength(0)
  })
})
