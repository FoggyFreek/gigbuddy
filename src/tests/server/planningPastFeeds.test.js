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

const TODAY = '2026-05-01'

describe('bounded rehearsal feeds', () => {
  it('separates all rehearsal statuses at today and enriches participants', async () => {
    const { rows: rehearsals } = await pool.query(
      `INSERT INTO rehearsals (tenant_id, proposed_date, status, location)
       VALUES ($1, DATE '2026-05-01', 'option', 'Today option'),
              ($1, DATE '2026-05-02', 'planned', 'Future planned'),
              ($1, DATE '2026-04-30', 'option', 'Past option'),
              ($2, DATE '2026-05-02', 'planned', 'Tenant B secret')
       RETURNING id, location`,
      [seed.tenantA.id, seed.tenantB.id],
    )
    const todayOption = rehearsals.find((row) => row.location === 'Today option')
    await pool.query(
      `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id, vote)
       VALUES ($1, $2, $3, 'yes')`,
      [seed.tenantA.id, todayOption.id, seed.memberA.id],
    )

    const upcoming = await asUserA(request(app).get('/api/rehearsals/upcoming').query({ limit: 10, today: TODAY })).expect(200)
    expect(upcoming.body.items.map((row) => row.location).filter(Boolean)).toEqual(expect.arrayContaining(['Today option', 'Future planned']))
    expect(upcoming.body.items.map((row) => row.location)).not.toContain('Tenant B secret')
    expect(upcoming.body.items[0].participants).toMatchObject([{ band_member_id: seed.memberA.id, vote: 'yes' }])

    const past = await asUserA(request(app).get('/api/rehearsals/past').query({ limit: 10, today: TODAY })).expect(200)
    expect(past.body.items.map((row) => row.location)).toEqual(['Past option'])
    expect(past.body.meta).toEqual({ limit: 10, returned: 1, nextCursor: null })
  })

  it('paginates past rehearsals with a deterministic date/id cursor', async () => {
    await pool.query(
      `INSERT INTO rehearsals (tenant_id, proposed_date, location)
       VALUES ($1, DATE '2026-04-30', 'Same day older id'),
              ($1, DATE '2026-04-30', 'Same day newer id'),
              ($1, DATE '2026-04-29', 'Oldest')`,
      [seed.tenantA.id],
    )

    const page1 = await asUserA(request(app).get('/api/rehearsals/past').query({ limit: 2, today: TODAY })).expect(200)
    expect(page1.body.items.map((row) => row.location)).toEqual(['Same day newer id', 'Same day older id'])

    const page2 = await asUserA(request(app).get('/api/rehearsals/past').query({
      limit: 2,
      today: TODAY,
      cursorDate: page1.body.meta.nextCursor.date,
      cursorId: page1.body.meta.nextCursor.id,
    })).expect(200)
    expect(page2.body.items.map((row) => row.location)).toEqual(['Oldest'])
    expect(page2.body.meta.nextCursor).toBeNull()
  })
})

describe('bounded band-event feeds', () => {
  it('keeps an event upcoming through its end date and isolates tenants', async () => {
    await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'In progress', DATE '2026-04-30', DATE '2026-05-02'),
              ($1, 'Ends today', DATE '2026-04-30', DATE '2026-05-01'),
              ($1, 'Ended yesterday', DATE '2026-04-29', DATE '2026-04-30'),
              ($2, 'Tenant B secret', DATE '2026-05-01', DATE '2026-05-02')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const upcoming = await asUserA(request(app).get('/api/band-events/upcoming').query({ limit: 10, today: TODAY })).expect(200)
    expect(upcoming.body.items.map((row) => row.title)).toEqual(expect.arrayContaining(['In progress', 'Ends today']))
    expect(upcoming.body.items.map((row) => row.title)).not.toContain('Tenant B secret')

    const past = await asUserA(request(app).get('/api/band-events/past').query({ limit: 10, today: TODAY })).expect(200)
    expect(past.body.items.map((row) => row.title)).toEqual(['Ended yesterday'])
  })

  it('paginates past band events and rejects malformed cursors', async () => {
    await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Recent', DATE '2026-04-30', DATE '2026-04-30'),
              ($1, 'Middle', DATE '2026-04-29', DATE '2026-04-29'),
              ($1, 'Oldest', DATE '2026-04-28', DATE '2026-04-28')`,
      [seed.tenantA.id],
    )

    const page1 = await asUserA(request(app).get('/api/band-events/past').query({ limit: 2, today: TODAY })).expect(200)
    expect(page1.body.items.map((row) => row.title)).toEqual(['Recent', 'Middle'])

    const page2 = await asUserA(request(app).get('/api/band-events/past').query({
      limit: 2,
      today: TODAY,
      cursorDate: page1.body.meta.nextCursor.date,
      cursorId: page1.body.meta.nextCursor.id,
    })).expect(200)
    expect(page2.body.items.map((row) => row.title)).toEqual(['Oldest'])

    const invalid = await asUserA(request(app).get('/api/band-events/past').query({
      limit: 10,
      today: TODAY,
      cursorDate: '2026-04-30',
    })).expect(400)
    expect(invalid.body).toEqual({ error: 'cursorDate and cursorId must be provided together and valid' })
  })
})
