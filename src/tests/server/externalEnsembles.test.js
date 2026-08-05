import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

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
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
})

afterAll(async () => {
  await pool.end()
})

const asUser = (userId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', 'null')

const inTenant = (userId, tenantId) => (req) =>
  req.set('x-test-user-id', String(userId)).set('x-test-tenant-id', String(tenantId))

async function createUser(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, email.split('@')[0]],
  )
  return rows[0]
}

async function createWorkspace(userId, slug = 'artist-ws') {
  const { rows: [ws] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
     VALUES ($1, 'Artist', 'Artist', 'personal', $2, $2) RETURNING *`,
    [slug, userId],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [userId, ws.id],
  )
  return ws
}

async function addContact(tenantId, name, category = 'ensemble') {
  const { rows } = await pool.query(
    `INSERT INTO contacts (tenant_id, name, category) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, name, category],
  )
  return rows[0]
}

// Not every band a musician plays in is a gigbuddy customer. Those exist only
// as 'ensemble' contacts in the musician's OWN workspace — never as shell
// tenants, which would consume the band cap and have no administrator.
describe('GET /api/me/bands — external ensembles', () => {
  it('unions real tenants and external ensembles, saying which is which', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const ensemble = await addContact(ws.id, 'The Covers Band')

    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    const byName = Object.fromEntries(res.body.items.map((b) => [b.displayName, b]))

    expect(byName['Alpha Band']).toMatchObject({ source: 'tenant', kind: 'band', contactId: null })
    expect(byName['Artist']).toBeUndefined()
    // An external band has no tenant of its own — only the musician's side.
    expect(byName['The Covers Band']).toMatchObject({
      source: 'contact',
      contactId: ensemble.id,
      tenantId: ws.id,
      kind: null,
      role: null,
      slug: null,
    })
  })

  it('never lists another musician\'s ensembles', async () => {
    const other = await createUser('other@test.local')
    const theirWs = await createWorkspace(other.id, 'other-ws')
    await addContact(theirWs.id, 'Their Band')
    await createWorkspace(seed.userA.id)

    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items.map((b) => b.displayName)).not.toContain('Their Band')
  })

  // A band's address book is the band's — it is not a roster of the bands its
  // members play in, so ensembles there are never treated as the caller's.
  it('ignores ensemble contacts that live in a band tenant', async () => {
    await addContact(seed.tenantA.id, 'Band Address Book Entry')
    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items.map((b) => b.displayName)).not.toContain('Band Address Book Entry')
  })

  it('does not mistake other contact categories for ensembles', async () => {
    const ws = await createWorkspace(seed.userA.id)
    await addContact(ws.id, 'A Booker', 'booker')
    const res = await asUser(seed.userA.id)(request(app).get('/api/me/bands')).expect(200)
    expect(res.body.items.map((b) => b.displayName)).not.toContain('A Booker')
  })

  it('does not consume the band cap', async () => {
    const ws = await createWorkspace(seed.userA.id)
    for (const name of ['One', 'Two', 'Three']) await addContact(ws.id, name)

    // Bronze allows one band; neither the workspace nor its ensembles count.
    await asUser(seed.userA.id)(
      request(app).post('/api/tenants').send({ band_name: 'Real Band', country_code: 'nl' }),
    ).expect(201)
  })
})

describe('tagging a gig with the ensemble it was played with', () => {
  it('rejects creating ensemble contacts in a band tenant', async () => {
    const res = await inTenant(seed.userA.id, seed.tenantA.id)(
      request(app).post('/api/contacts').send({ name: 'Side Project', category: 'ensemble' }),
    ).expect(403)
    expect(res.body).toMatchObject({ code: 'tenant_kind_not_supported', kind: 'band' })
  })

  it('rejects ensemble tags in a band tenant', async () => {
    const ensemble = await addContact(seed.tenantA.id, 'Side Project')
    const res = await inTenant(seed.userA.id, seed.tenantA.id)(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show', ensemble_contact_id: ensemble.id,
    })).expect(403)
    expect(res.body).toMatchObject({ code: 'tenant_kind_not_supported', kind: 'band' })
  })

  it('stores the tag and reads it back', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const ensemble = await addContact(ws.id, 'The Covers Band')
    const as = inTenant(seed.userA.id, ws.id)

    const created = await as(request(app).post('/api/gigs').send({
      event_date: '2099-07-10',
      event_description: 'A Show',
      ensemble_contact_id: ensemble.id,
    })).expect(201)
    expect(created.body.ensemble_contact_id).toBe(ensemble.id)

    const listed = await as(request(app).get('/api/gigs')).expect(200)
    expect(listed.body[0].ensemble_contact_id).toBe(ensemble.id)
  })

  it('rejects a contact of the wrong category', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const booker = await addContact(ws.id, 'A Booker', 'booker')

    await inTenant(seed.userA.id, ws.id)(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show', ensemble_contact_id: booker.id,
    })).expect(400)
  })

  // The composite FK is the DB backstop; the service is the primary gate.
  it('rejects an ensemble belonging to another tenant, writing nothing', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const foreign = await addContact(seed.tenantB.id, 'Foreign Band')

    await inTenant(seed.userA.id, ws.id)(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show', ensemble_contact_id: foreign.id,
    })).expect(400)

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM gigs WHERE tenant_id = $1', [ws.id],
    )
    expect(rows[0].count).toBe(0)
  })

  it('rejects a cross-tenant ensemble on PATCH too', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const as = inTenant(seed.userA.id, ws.id)
    const created = await as(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show',
    })).expect(201)
    const foreign = await addContact(seed.tenantB.id, 'Foreign Band')

    await as(request(app).patch(`/api/gigs/${created.body.id}`)
      .send({ ensemble_contact_id: foreign.id })).expect(400)
  })

  it('clears the tag with null', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const ensemble = await addContact(ws.id, 'The Covers Band')
    const as = inTenant(seed.userA.id, ws.id)

    const created = await as(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show', ensemble_contact_id: ensemble.id,
    })).expect(201)

    const patched = await as(request(app).patch(`/api/gigs/${created.body.id}`)
      .send({ ensemble_contact_id: null })).expect(200)
    expect(patched.body.ensemble_contact_id).toBeNull()
  })

  // Deleting the ensemble must not take the gig with it — the gig happened.
  it('keeps the gig when its ensemble contact is deleted', async () => {
    const ws = await createWorkspace(seed.userA.id)
    const ensemble = await addContact(ws.id, 'The Covers Band')
    const as = inTenant(seed.userA.id, ws.id)

    const created = await as(request(app).post('/api/gigs').send({
      event_date: '2099-07-10', event_description: 'A Show', ensemble_contact_id: ensemble.id,
    })).expect(201)

    await pool.query('DELETE FROM contacts WHERE id = $1', [ensemble.id])

    const { rows } = await pool.query('SELECT ensemble_contact_id FROM gigs WHERE id = $1',
      [created.body.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].ensemble_contact_id).toBeNull()
  })
})
