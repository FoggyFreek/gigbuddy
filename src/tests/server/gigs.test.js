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
