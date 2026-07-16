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

function taskA() {
  return seed.tasks.find((t) => t.tenant_id === seed.tenantA.id)
}

describe('POST /api/tasks — standalone task creation', () => {
  it('creates a task with no gig_id (omitted)', async () => {
    const res = await asUserA(
      request(app).post('/api/tasks').send({ title: 'Standalone chore' }),
    ).expect(201)
    expect(res.body.title).toBe('Standalone chore')
    expect(res.body.gig_id).toBeNull()
  })

  it('treats explicit gig_id: null the same as omitted', async () => {
    const res = await asUserA(
      request(app).post('/api/tasks').send({ title: 'Null gig', gig_id: null }),
    ).expect(201)
    expect(res.body.gig_id).toBeNull()
  })

  it('creates a task linked to a same-tenant gig', async () => {
    const res = await asUserA(
      request(app).post('/api/tasks').send({ title: 'Linked', gig_id: seed.gigA.id }),
    ).expect(201)
    expect(res.body.gig_id).toBe(seed.gigA.id)
  })

  it('rejects a missing title with 400', async () => {
    await asUserA(request(app).post('/api/tasks').send({})).expect(400)
  })

  it('rejects another tenant\'s gig_id with 404 (isolation)', async () => {
    const res = await asUserA(
      request(app).post('/api/tasks').send({ title: 'X', gig_id: seed.gigB.id }),
    ).expect(404)
    expect(res.body.error).toMatch(/not found/i)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM gig_tasks WHERE title = $1', ['X'])
    expect(rows[0].n).toBe(0)
  })

  it('persists assigned_to when provided', async () => {
    const res = await asUserA(
      request(app).post('/api/tasks').send({ title: 'Assigned', assigned_to: seed.memberA.id }),
    ).expect(201)
    expect(res.body.assigned_to).toBe(seed.memberA.id)
  })
})

describe('GET /api/tasks — includes gig-less tasks (LEFT JOIN)', () => {
  it('returns both gig-linked and gig-less tasks', async () => {
    await asUserA(request(app).post('/api/tasks').send({ title: 'No gig' })).expect(201)
    const res = await asUserA(request(app).get('/api/tasks')).expect(200)
    expect(res.body.meta).toEqual({ limit: 10, returned: 2, total: 2 })
    const byTitle = Object.fromEntries(res.body.items.map((t) => [t.title, t]))
    expect(byTitle['Alpha task'].event_description).toBe('Alpha Gig')
    expect(byTitle['No gig']).toBeDefined()
    expect(byTitle['No gig'].gig_id).toBeNull()
    expect(byTitle['No gig'].event_description ?? null).toBeNull()
  })
})

describe('PATCH/DELETE /api/tasks/:id', () => {
  it('PATCH toggles done', async () => {
    const res = await asUserA(
      request(app).patch(`/api/tasks/${taskA().id}`).send({ done: true }),
    ).expect(200)
    expect(res.body.done).toBe(true)
  })

  it('DELETE removes the task (204)', async () => {
    await asUserA(request(app).delete(`/api/tasks/${taskA().id}`)).expect(204)
    const { rows } = await pool.query('SELECT 1 FROM gig_tasks WHERE id = $1', [taskA().id])
    expect(rows).toHaveLength(0)
  })

  it('PATCH a cross-tenant task returns 404', async () => {
    const taskB = seed.tasks.find((t) => t.tenant_id === seed.tenantB.id)
    await asUserA(request(app).patch(`/api/tasks/${taskB.id}`).send({ done: true })).expect(404)
  })
})

describe('nested gig task routes stay gig-scoped after unification', () => {
  it('PATCH/DELETE via the wrong (but same-tenant) gig URL returns 404', async () => {
    // A second gig in tenant A; taskA() belongs to gigA, not this one.
    const { rows: [otherGig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2026-09-01', 'Other Alpha Gig') RETURNING id`,
      [seed.tenantA.id],
    )
    await asUserA(
      request(app).patch(`/api/gigs/${otherGig.id}/tasks/${taskA().id}`).send({ done: true }),
    ).expect(404)
    await asUserA(
      request(app).delete(`/api/gigs/${otherGig.id}/tasks/${taskA().id}`),
    ).expect(404)
    // Untouched.
    const { rows } = await pool.query('SELECT done FROM gig_tasks WHERE id = $1', [taskA().id])
    expect(rows[0].done).toBe(false)
  })
})
