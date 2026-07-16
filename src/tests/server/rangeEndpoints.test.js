import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

// 2027 avoids collisions with the 2026 fixtures created by seedTwoTenants.
const WINDOW = { from: '2027-07-01', to: '2027-07-31' }

describe('windowed range endpoints', () => {
  it('returns gigs inside the inclusive window with an isolated tenant scope', async () => {
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2027-06-30', 'Before A'),
              ($1, '2027-07-01', 'First A'),
              ($1, '2027-07-31', 'Last A'),
              ($1, '2027-08-01', 'After A'),
              ($2, '2027-07-15', 'Tenant B secret')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const res = await asUserA(request(app).get('/api/gigs/range').query(WINDOW)).expect(200)
    expect(res.body.meta).toEqual({ from: WINDOW.from, to: WINDOW.to, returned: 2 })
    expect(res.body.items.map((g) => g.event_description)).toEqual(['First A', 'Last A'])
    expect(res.body.items[0].members_availability).toMatchObject([{ name: 'Alpha Member', status: 'default' }])
  })

  it('returns rehearsals of any status inside the window with participants attached', async () => {
    await pool.query(
      `INSERT INTO rehearsals (tenant_id, proposed_date, status, location)
       VALUES ($1, '2027-07-10', 'planned', 'Studio A'),
              ($1, '2027-07-20', 'option', 'Studio A option'),
              ($1, '2027-08-02', 'planned', 'Outside window'),
              ($2, '2027-07-10', 'planned', 'Tenant B secret')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const res = await asUserA(request(app).get('/api/rehearsals/range').query(WINDOW)).expect(200)
    expect(res.body.meta).toEqual({ from: WINDOW.from, to: WINDOW.to, returned: 2 })
    expect(res.body.items.map((r) => r.location)).toEqual(['Studio A', 'Studio A option'])
    expect(res.body.items[0].participants).toEqual([])
  })

  it('includes band events overlapping the window, not just those starting inside it', async () => {
    await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Straddles start', '2027-06-28', '2027-07-02'),
              ($1, 'Inside', '2027-07-10', '2027-07-10'),
              ($1, 'Straddles end', '2027-07-30', '2027-08-03'),
              ($1, 'Entirely before', '2027-06-01', '2027-06-05'),
              ($1, 'Entirely after', '2027-08-10', '2027-08-12'),
              ($2, 'Tenant B secret', '2027-07-10', '2027-07-10')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const res = await asUserA(request(app).get('/api/band-events/range').query(WINDOW)).expect(200)
    expect(res.body.meta).toEqual({ from: WINDOW.from, to: WINDOW.to, returned: 3 })
    expect(res.body.items.map((e) => e.title)).toEqual(['Straddles start', 'Inside', 'Straddles end'])
  })

  it('rejects malformed or inverted windows with a stable 400 response', async () => {
    const expectedError = { error: 'from and to must be valid ISO dates (YYYY-MM-DD) with from <= to' }

    const missing = await asUserA(request(app).get('/api/gigs/range').query({ from: '2027-07-01' })).expect(400)
    expect(missing.body).toEqual(expectedError)

    await asUserA(request(app).get('/api/gigs/range').query({ from: '2027-07-31', to: '2027-07-01' })).expect(400)
    await asUserA(request(app).get('/api/rehearsals/range').query({ from: '2027-13-01', to: '2027-12-31' })).expect(400)
    await asUserA(request(app).get('/api/band-events/range').query({ from: '20270701', to: '2027-07-31' })).expect(400)
  })
})
