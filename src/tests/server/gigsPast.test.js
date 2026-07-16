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

// Before the '2026-06-01'/'2026-06-02' fixture gigs seedTwoTenants() creates,
// so those don't leak into these past-gig assertions as extra rows.
const TODAY = '2026-05-01'

describe('GET /api/gigs/past', () => {
  it('returns past gigs most-recent-first, isolated by tenant, with availability enriched', async () => {
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, DATE '2026-05-01', 'Today is not past'),
              ($1, DATE '2026-04-30', 'Last A'),
              ($1, DATE '2026-04-10', 'Earlier A'),
              ($2, DATE '2026-04-30', 'Tenant B secret')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const res = await asUserA(request(app).get('/api/gigs/past').query({ limit: 10, today: TODAY })).expect(200)
    expect(res.body.items.map((g) => g.event_description)).toEqual(['Last A', 'Earlier A'])
    expect(res.body.meta).toEqual({ limit: 10, returned: 2, nextCursor: null })
    expect(res.body.items[0].members_availability).toMatchObject([{ name: 'Alpha Member', status: 'default' }])
  })

  it('paginates with a keyset cursor instead of offset, never repeating or skipping rows', async () => {
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, DATE '2026-04-30', 'Gig 3'),
              ($1, DATE '2026-04-29', 'Gig 2'),
              ($1, DATE '2026-04-28', 'Gig 1')`,
      [seed.tenantA.id],
    )

    const page1 = await asUserA(request(app).get('/api/gigs/past').query({ limit: 2, today: TODAY })).expect(200)
    expect(page1.body.items.map((g) => g.event_description)).toEqual(['Gig 3', 'Gig 2'])
    expect(page1.body.meta.nextCursor).toBeTruthy()

    const page2 = await asUserA(request(app).get('/api/gigs/past').query({
      limit: 2,
      today: TODAY,
      cursorDate: page1.body.meta.nextCursor.date,
      cursorId: page1.body.meta.nextCursor.id,
    })).expect(200)
    expect(page2.body.items.map((g) => g.event_description)).toEqual(['Gig 1'])
    expect(page2.body.meta.nextCursor).toBeNull()
  })

  it('rejects malformed limit, today, or a half-supplied cursor with a stable 400', async () => {
    const badLimit = await asUserA(request(app).get('/api/gigs/past').query({ limit: '1x', today: TODAY })).expect(400)
    expect(badLimit.body).toEqual({ error: 'limit must be an integer between 1 and 100' })

    const badToday = await asUserA(request(app).get('/api/gigs/past').query({ limit: 10, today: 'not-a-date' })).expect(400)
    expect(badToday.body).toEqual({ error: 'today must be a valid ISO date (YYYY-MM-DD)' })

    const halfCursor = await asUserA(request(app).get('/api/gigs/past').query({ limit: 10, today: TODAY, cursorDate: '2099-01-01' })).expect(400)
    expect(halfCursor.body).toEqual({ error: 'cursorDate and cursorId must be provided together and valid' })
  })
})

describe('GET /api/gigs/upcoming', () => {
  it('includes member availability in the response', async () => {
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, DATE '2099-07-17', 'Next A')`,
      [seed.tenantA.id],
    )

    const res = await asUserA(request(app).get('/api/gigs/upcoming').query({ limit: 10, today: TODAY })).expect(200)
    expect(res.body.items[0].members_availability).toMatchObject([{ name: 'Alpha Member', status: 'default' }])
  })
})
