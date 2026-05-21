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
