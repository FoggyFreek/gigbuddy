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

describe('dashboard overview endpoints', () => {
  it('returns limited upcoming gigs with the isolated total in the same envelope', async () => {
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, DATE '2099-07-15', 'Past in browser timezone'),
              ($1, DATE '2099-07-16', 'Next A'),
              ($1, DATE '2099-07-17', 'Later A'),
              ($2, DATE '2099-07-16', 'Tenant B secret')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const upcoming = await asUserA(request(app).get('/api/gigs/upcoming').query({ limit: 1, today: '2099-07-16' })).expect(200)
    expect(upcoming.body.meta).toEqual({ limit: 1, returned: 1, total: 2 })
    expect(upcoming.body.items).toHaveLength(1)
    expect(upcoming.body.items[0].event_description).toBe('Next A')
  })

  it('returns the next planned rehearsal and limited upcoming band event for the active tenant', async () => {
    await pool.query(
      `INSERT INTO rehearsals (tenant_id, proposed_date, status, location)
       VALUES ($1, CURRENT_DATE + 1, 'planned', 'Studio A'),
              ($1, CURRENT_DATE + 2, 'planned', 'Studio A later'),
              ($2, CURRENT_DATE + 1, 'planned', 'Tenant B secret')`,
      [seed.tenantA.id, seed.tenantB.id],
    )
    await pool.query(
      `INSERT INTO band_events (tenant_id, title, start_date, end_date)
       VALUES ($1, 'Past in browser timezone', DATE '2099-07-15', DATE '2099-07-15'),
              ($1, 'Event A', DATE '2099-07-16', DATE '2099-07-16'),
              ($1, 'Event A later', DATE '2099-07-17', DATE '2099-07-17'),
              ($2, 'Tenant B secret', DATE '2099-07-16', DATE '2099-07-16')`,
      [seed.tenantA.id, seed.tenantB.id],
    )

    const rehearsal = await asUserA(request(app).get('/api/rehearsals/next')).expect(200)
    expect(rehearsal.body.location).toBe('Studio A')

    const events = await asUserA(request(app).get('/api/band-events/upcoming').query({ limit: 1, today: '2099-07-16' })).expect(200)
    expect(events.body.meta).toEqual({ limit: 1, returned: 1 })
    expect(events.body.items).toHaveLength(1)
    expect(events.body.items[0].title).toBe('Event A')
  })

  it('returns limited open tasks for the requested assignee with the isolated total', async () => {
    await pool.query(
      `INSERT INTO gig_tasks (tenant_id, title, due_date, assigned_to, done)
       VALUES ($1, 'Overdue A', CURRENT_DATE - 1, $2, FALSE),
              ($1, 'Upcoming A', CURRENT_DATE + 1, $2, FALSE),
              ($1, 'Done A', CURRENT_DATE, $2, TRUE),
              ($3, 'Tenant B secret', CURRENT_DATE, $4, FALSE)`,
      [seed.tenantA.id, seed.memberA.id, seed.tenantB.id, seed.memberB.id],
    )

    const tasks = await asUserA(request(app).get('/api/tasks').query({
      limit: 1,
      assignee: 'me',
      done: false,
    })).expect(200)
    expect(tasks.body.meta).toEqual({ limit: 1, returned: 1, total: 2 })
    expect(tasks.body.items).toHaveLength(1)
    expect(tasks.body.items[0].title).toBe('Overdue A')

    const defaultLimit = await asUserA(request(app).get('/api/tasks').query({
      assignee: 'me',
      done: false,
    })).expect(200)
    expect(defaultLimit.body.meta).toEqual({ limit: 10, returned: 2, total: 2 })
  })

  it('uses the same task collection for band-wide and explicit-member views', async () => {
    const { rows: [memberA2] } = await pool.query(
      `INSERT INTO band_members (tenant_id, name, role)
       VALUES ($1, 'Other Alpha member', 'member') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gig_tasks (tenant_id, title, assigned_to, done)
       VALUES ($1, 'Mine', $2, FALSE),
              ($1, 'Another member', $3, FALSE),
              ($1, 'Unassigned', NULL, FALSE),
              ($4, 'Tenant B secret', $5, FALSE)`,
      [seed.tenantA.id, seed.memberA.id, memberA2.id, seed.tenantB.id, seed.memberB.id],
    )

    const bandWide = await asUserA(request(app).get('/api/tasks').query({
      limit: 10,
      done: false,
    })).expect(200)
    expect(bandWide.body.items.map((task) => task.title)).toEqual([
      'Alpha task',
      'Mine',
      'Another member',
      'Unassigned',
    ])
    expect(bandWide.body.meta.total).toBe(4)

    const anotherMember = await asUserA(request(app).get('/api/tasks').query({
      limit: 10,
      assignee: memberA2.id,
      done: false,
    })).expect(200)
    expect(anotherMember.body.items.map((task) => task.title)).toEqual(['Another member'])
  })

  it('returns a zero total when a limited feed has no rows', async () => {
    const gigs = await asUserA(request(app).get('/api/gigs/upcoming').query({ limit: 1, today: '2099-07-16' })).expect(200)
    expect(gigs.body).toEqual({ items: [], meta: { limit: 1, returned: 0, total: 0 } })

    const tasks = await asUserA(request(app).get('/api/tasks').query({
      limit: 1,
      assignee: 'me',
      done: false,
    })).expect(200)
    expect(tasks.body).toEqual({ items: [], meta: { limit: 1, returned: 0, total: 0 } })
  })

  it('rejects malformed or out-of-range limits with a stable 400 response', async () => {
    const malformed = await asUserA(request(app).get('/api/gigs/upcoming').query({ limit: '1x', today: '2099-07-16' })).expect(400)
    expect(malformed.body).toEqual({ error: 'limit must be an integer between 1 and 100' })

    await asUserA(request(app).get('/api/tasks').query({ limit: 500, assignee: 'me', done: false })).expect(200)
    const tooManyTasks = await asUserA(request(app).get('/api/tasks').query({ limit: 501, assignee: 'me', done: false })).expect(400)
    expect(tooManyTasks.body).toEqual({ error: 'limit must be an integer between 1 and 500' })
  })

  it('rejects malformed task collection filters', async () => {
    const invalidDone = await asUserA(request(app).get('/api/tasks').query({
      limit: 5,
      done: 'open',
    })).expect(400)
    expect(invalidDone.body).toEqual({ error: 'done must be true or false' })

    const invalidAssignee = await asUserA(request(app).get('/api/tasks').query({
      limit: 5,
      assignee: 'somebody',
    })).expect(400)
    expect(invalidAssignee.body).toEqual({ error: 'assignee must be me or a positive member id' })
  })

  it('requires a valid browser-local date for date-filtered dashboard endpoints', async () => {
    for (const path of ['/api/gigs/upcoming', '/api/rehearsals/upcoming', '/api/band-events/upcoming']) {
      const missing = await asUserA(request(app).get(path).query({ limit: 1 })).expect(400)
      expect(missing.body).toEqual({ error: 'today must be a valid ISO date (YYYY-MM-DD)' })

      await asUserA(request(app).get(path).query({ limit: 1, today: '2099-02-29' })).expect(400)
    }
  })
})
