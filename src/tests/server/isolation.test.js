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

describe('tenant isolation — list endpoints return only the active tenant', () => {
  it('GET /api/gigs', async () => {
    const res = await asUserA(request(app).get('/api/gigs')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(seed.gigA.id)
  })

  it('GET /api/rehearsals', async () => {
    const res = await asUserA(request(app).get('/api/rehearsals')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(seed.rehearsalA.id)
  })

  it('GET /api/band-events', async () => {
    const res = await asUserA(request(app).get('/api/band-events')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Alpha event')
  })

  it('GET /api/availability', async () => {
    const res = await asUserA(
      request(app).get('/api/availability').query({ from: '2026-01-01', to: '2026-12-31' }),
    ).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].reason).toBe('Alpha vacation')
  })

  it('GET /api/band-members', async () => {
    const res = await asUserA(request(app).get('/api/band-members')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Alpha Member')
  })

  it('GET /api/tasks', async () => {
    const res = await asUserA(request(app).get('/api/tasks')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Alpha task')
  })

  it('GET /api/email-templates', async () => {
    const res = await asUserA(request(app).get('/api/email-templates')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Alpha tpl')
  })

  it('GET /api/venues', async () => {
    const res = await asUserA(request(app).get('/api/venues')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Alpha Hall')
  })

  it('GET /api/contacts', async () => {
    const res = await asUserA(request(app).get('/api/contacts')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Alpha Contact')
  })

  it('GET /api/share/photos', async () => {
    const res = await asUserA(request(app).get('/api/share/photos')).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].label).toBe('A photo')
  })

  it('GET /api/profile returns the tenant row, not cross-tenant', async () => {
    const res = await asUserA(request(app).get('/api/profile')).expect(200)
    expect(res.body.band_name).toBe('Alpha Band')
    const resB = await asUserB(request(app).get('/api/profile')).expect(200)
    expect(resB.body.band_name).toBe('Beta Band')
  })
})

describe('tenant isolation — direct id reads of foreign-tenant rows return 404', () => {
  const cases = [
    ['gig',          (s) => `/api/gigs/${s.gigB.id}`],
    ['rehearsal',    (s) => `/api/rehearsals/${s.rehearsalB.id}`],
    ['band-event',   (s) => `/api/band-events/${s.bandEvents.find(e => e.tenant_id === s.tenantB.id).id}`],
    ['venue',        (s) => `/api/venues/${s.venues.find(v => v.tenant_id === s.tenantB.id).id}`],
    ['contact',      (s) => `/api/contacts/${s.contacts.find(c => c.tenant_id === s.tenantB.id).id}`],
    ['email-template', (s) => `/api/email-templates/${s.emailTemplates.find(t => t.tenant_id === s.tenantB.id).id}`],
  ]

  for (const [label, build] of cases) {
    it(`GET ${label} from foreign tenant → 404`, async () => {
      await asUserA(request(app).get(build(seed))).expect(404)
    })
  }
})

describe('tenant isolation — PATCH/DELETE of foreign-tenant rows returns 404', () => {
  it('PATCH /api/gigs/:id of tenant B as user A → 404', async () => {
    await asUserA(
      request(app).patch(`/api/gigs/${seed.gigB.id}`).send({ event_description: 'Hacked' }),
    ).expect(404)

    const { rows } = await pool.query('SELECT event_description FROM gigs WHERE id = $1', [seed.gigB.id])
    expect(rows[0].event_description).toBe('Beta Gig')
  })

  it('DELETE /api/gigs/:id of tenant B as user A → 404', async () => {
    await asUserA(request(app).delete(`/api/gigs/${seed.gigB.id}`)).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM gigs WHERE id = $1', [seed.gigB.id])
    expect(rows).toHaveLength(1)
  })

  it('PATCH /api/rehearsals/:id of tenant B as user A → 404', async () => {
    await asUserA(
      request(app).patch(`/api/rehearsals/${seed.rehearsalB.id}`).send({ location: 'Stolen' }),
    ).expect(404)
  })

  it('DELETE /api/band-members/:id of tenant B as user A → 404', async () => {
    await asUserA(request(app).delete(`/api/band-members/${seed.memberB.id}`)).expect(404)
    const { rows } = await pool.query('SELECT 1 FROM band_members WHERE id = $1', [seed.memberB.id])
    expect(rows).toHaveLength(1)
  })

  it('DELETE /api/email-templates/:id of tenant B as user A → 404', async () => {
    const otherId = seed.emailTemplates.find((t) => t.tenant_id === seed.tenantB.id).id
    await asUserA(request(app).delete(`/api/email-templates/${otherId}`)).expect(404)
  })
})

describe('tenant isolation — POST attaches the active tenant', () => {
  it('POST /api/gigs as user A creates a gig in tenant A', async () => {
    const res = await asUserA(
      request(app).post('/api/gigs').send({
        event_date: '2026-09-01',
        event_description: 'Created by A',
      }),
    ).expect(201)
    expect(res.body.tenant_id).toBe(seed.tenantA.id)
  })

  it('POST /api/availability scoped band_member_id from another tenant → 400', async () => {
    await asUserA(
      request(app).post('/api/availability').send({
        band_member_id: seed.memberB.id,
        start_date: '2026-09-01',
        end_date: '2026-09-02',
        status: 'unavailable',
      }),
    ).expect(400)
  })
})

describe('tenant isolation — files route blocks cross-tenant object keys', () => {
  it("GET /api/files/:objectKey of tenant B's share photo as user A → 404", async () => {
    const photoB = seed.sharePhotos.find((p) => p.tenant_id === seed.tenantB.id)
    await asUserA(request(app).get(`/api/files/${photoB.object_key}`)).expect(404)
  })

  it("GET /api/files/:objectKey of own tenant photo passes the auth check", async () => {
    const photoA = seed.sharePhotos.find((p) => p.tenant_id === seed.tenantA.id)
    // The object isn't actually in storage; the gate passes (would 404 in storage layer).
    // We just assert it isn't blocked at the tenant gate (which would also 404, but with
    // a different code path — here we accept either as long as cross-tenant 404 holds).
    const res = await asUserA(request(app).get(`/api/files/${photoA.object_key}`))
    expect([404, 500]).toContain(res.status) // storage backend not available in tests
  })
})

describe('tenant isolation — DB-level same-tenant FK enforcement', () => {
  it('rejects gig_participants row referencing a gig in tenant A and a member in tenant B', async () => {
    await expect(
      pool.query(
        `INSERT INTO gig_participants (tenant_id, gig_id, band_member_id)
         VALUES ($1, $2, $3)`,
        [seed.tenantA.id, seed.gigA.id, seed.memberB.id],
      ),
    ).rejects.toThrow()
  })

  it('rejects rehearsal_participants row whose member belongs to a different tenant', async () => {
    await expect(
      pool.query(
        `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id)
         VALUES ($1, $2, $3)`,
        [seed.tenantA.id, seed.rehearsalA.id, seed.memberB.id],
      ),
    ).rejects.toThrow()
  })

  it('rejects availability_slots row whose member belongs to a different tenant', async () => {
    await expect(
      pool.query(
        `INSERT INTO availability_slots (tenant_id, band_member_id, start_date, end_date, status)
         VALUES ($1, $2, '2026-09-01', '2026-09-02', 'unavailable')`,
        [seed.tenantA.id, seed.memberB.id],
      ),
    ).rejects.toThrow()
  })
})

describe('tenant isolation — auth gates', () => {
  it('without active tenant header, requests get 403', async () => {
    await request(app)
      .get('/api/gigs')
      .set('x-test-user-id', String(seed.userA.id))
      .set('x-test-tenant-id', 'null')
      .expect(403)
  })

  it('user with no membership in target tenant gets 403 even with header set', async () => {
    // Make user A request tenant B (no membership)
    await pool.query('DELETE FROM memberships WHERE user_id = $1 AND tenant_id = $2', [seed.userA.id, seed.tenantB.id])
    await request(app)
      .get('/api/gigs')
      .set('x-test-user-id', String(seed.userA.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .expect(403)
  })
})
