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

describe('GET /api/contacts - category filters', () => {
  it('returns only supplier contacts when category=supplier', async () => {
    await pool.query(
      `INSERT INTO contacts (tenant_id, name, category) VALUES
       ($1, 'Alpha Supplier', 'supplier'),
       ($2, 'Beta Supplier', 'supplier')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const res = await asUserA(request(app).get('/api/contacts?category=supplier')).expect(200)
    expect(res.body.map((c) => c.name)).toEqual(['Alpha Supplier'])
    expect(res.body.every((c) => c.category === 'supplier')).toBe(true)
  })

  it('excludes supplier contacts when excludeCategory=supplier', async () => {
    await pool.query(
      `INSERT INTO contacts (tenant_id, name, category)
       VALUES ($1, 'Alpha Supplier', 'supplier')`,
      [seed.tenantA.id],
    )

    const res = await asUserA(request(app).get('/api/contacts?excludeCategory=supplier')).expect(200)
    expect(res.body.map((c) => c.name)).toEqual(['Alpha Contact'])
    expect(res.body.every((c) => c.category !== 'supplier')).toBe(true)
  })

  it('returns 400 for invalid category filters', async () => {
    await asUserA(request(app).get('/api/contacts?category=invalid')).expect(400)
    await asUserA(request(app).get('/api/contacts?excludeCategory=invalid')).expect(400)
  })
})

describe('GET /api/contacts/search — category filter', () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO contacts (tenant_id, name, category) VALUES
       ($1, 'Alpha Supplier', 'supplier'),
       ($2, 'Beta Supplier', 'supplier')`,
      [seed.tenantA.id, seed.tenantB.id],
    )
  })

  it('excludeCategory=supplier returns contacts but not suppliers', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search')
      .query({ q: 'Alpha', excludeCategory: 'supplier' })).expect(200)
    expect(res.body.map((c) => c.name)).toEqual(['Alpha Contact'])
  })

  it('category=supplier returns only suppliers', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search')
      .query({ q: 'Alpha', category: 'supplier' })).expect(200)
    expect(res.body.map((c) => c.name)).toEqual(['Alpha Supplier'])
  })

  it('isolates tenants: userA cannot find tenant B suppliers', async () => {
    const res = await asUserA(request(app).get('/api/contacts/search')
      .query({ q: 'Beta Supplier', category: 'supplier' })).expect(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/contacts/:id — includes notes array', () => {
  it('returns empty notes array when contact has no notes', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    const res = await asUserA(request(app).get(`/api/contacts/${contactId}`)).expect(200)
    expect(res.body.notes).toEqual([])
  })

  it('returns notes ordered newest first', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    await pool.query(
      `INSERT INTO contact_notes (contact_id, tenant_id, note, created_at) VALUES
       ($1, $2, 'older note', '2026-01-01'),
       ($1, $2, 'newer note', '2026-06-01')`,
      [contactId, seed.tenantA.id],
    )
    const res = await asUserA(request(app).get(`/api/contacts/${contactId}`)).expect(200)
    expect(res.body.notes).toHaveLength(2)
    expect(res.body.notes[0].note).toBe('newer note')
    expect(res.body.notes[1].note).toBe('older note')
  })
})

describe('POST /api/contacts/:id/notes', () => {
  it('creates a note and returns 201', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    const res = await asUserA(
      request(app).post(`/api/contacts/${contactId}/notes`).send({ note: 'Hello world' }),
    ).expect(201)
    expect(res.body.note).toBe('Hello world')
    expect(res.body.contact_id).toBe(contactId)
  })

  it('returns 400 for blank note', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    const res = await asUserA(
      request(app).post(`/api/contacts/${contactId}/notes`).send({ note: '   ' }),
    ).expect(400)
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown contact', async () => {
    const res = await asUserA(
      request(app).post('/api/contacts/99999/notes').send({ note: 'x' }),
    ).expect(404)
    expect(res.status).toBe(404)
  })

  it('tenant isolation — user A cannot add notes to tenant B contact', async () => {
    const contactB = seed.contacts.find((c) => c.tenant_id === seed.tenantB.id)
    await asUserA(
      request(app).post(`/api/contacts/${contactB.id}/notes`).send({ note: 'cross-tenant' }),
    ).expect(404)
    const { rows } = await pool.query('SELECT id FROM contact_notes WHERE contact_id = $1', [contactB.id])
    expect(rows).toHaveLength(0)
  })
})

describe('DELETE /api/contacts/:id/notes/:noteId', () => {
  it('deletes an existing note and returns 204', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    const { rows } = await pool.query(
      `INSERT INTO contact_notes (contact_id, tenant_id, note) VALUES ($1, $2, 'to delete') RETURNING id`,
      [contactId, seed.tenantA.id],
    )
    const noteId = rows[0].id
    await asUserA(
      request(app).delete(`/api/contacts/${contactId}/notes/${noteId}`),
    ).expect(204)
    const { rows: remaining } = await pool.query(
      'SELECT id FROM contact_notes WHERE id = $1', [noteId],
    )
    expect(remaining).toHaveLength(0)
  })

  it('returns 404 for unknown note', async () => {
    const contactId = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id).id
    const res = await asUserA(
      request(app).delete(`/api/contacts/${contactId}/notes/99999`),
    ).expect(404)
    expect(res.status).toBe(404)
  })

  it('tenant isolation — user A cannot delete notes on tenant B contact', async () => {
    const contactB = seed.contacts.find((c) => c.tenant_id === seed.tenantB.id)
    const { rows } = await pool.query(
      `INSERT INTO contact_notes (contact_id, tenant_id, note) VALUES ($1, $2, 'b note') RETURNING id`,
      [contactB.id, seed.tenantB.id],
    )
    const noteId = rows[0].id
    await asUserA(
      request(app).delete(`/api/contacts/${contactB.id}/notes/${noteId}`),
    ).expect(404)
    const { rows: remaining } = await pool.query('SELECT id FROM contact_notes WHERE id = $1', [noteId])
    expect(remaining).toHaveLength(1)
  })
})
