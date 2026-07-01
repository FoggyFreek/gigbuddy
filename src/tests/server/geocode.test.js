// Disable the provider before anything imports the service (it reads this flag
// at module load), so the route test is deterministic and never hits the
// network — geocodePlace then returns { status: 'fail' } for any valid place.
process.env.GEOCODING_ENABLED = 'false'

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

describe('GET /api/geocode', () => {
  it('400s when city is missing', async () => {
    await asUserA(request(app).get('/api/geocode').query({ country: 'NL' })).expect(400)
  })

  it('400s when a parameter exceeds the length limit', async () => {
    await asUserA(
      request(app).get('/api/geocode').query({ city: 'Utrecht', address: 'x'.repeat(121) }),
    ).expect(400)
  })

  it('accepts address/postalCode and returns the service result shape', async () => {
    // Provider disabled → deterministic { status: 'fail' }; the point is that the
    // new params pass validation and reach the service without a 400.
    const res = await asUserA(
      request(app).get('/api/geocode').query({
        city: 'Utrecht', country: 'NL', address: 'Domplein 1', postalCode: '3512 JC',
      }),
    ).expect(200)

    expect(res.body).toHaveProperty('status')
    expect(['hit', 'empty', 'fail']).toContain(res.body.status)
  })
})
