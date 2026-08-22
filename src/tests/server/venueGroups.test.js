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
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedContactsAndVenues(seed)
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

const venueA = () => seed.venues.find((venue) => venue.tenant_id === seed.tenantA.id)
const venueB = () => seed.venues.find((venue) => venue.tenant_id === seed.tenantB.id)

function createGroup(name, venueIds = [venueA().id]) {
  return asUserA(request(app).post('/api/venue-groups').send({ name, venue_ids: venueIds }))
}

describe('venue groups', () => {
  it('lists the first ten matching groups alphabetically in a bounded envelope', async () => {
    for (let index = 12; index >= 1; index--) {
      await createGroup(`Tour ${String(index).padStart(2, '0')}`).expect(201)
    }

    const first = await asUserA(request(app).get('/api/venue-groups')).expect(200)
    expect(first.body.meta).toEqual({ limit: 10, returned: 10 })
    expect(first.body.items.map((group) => group.name)).toEqual([
      'Tour 01', 'Tour 02', 'Tour 03', 'Tour 04', 'Tour 05',
      'Tour 06', 'Tour 07', 'Tour 08', 'Tour 09', 'Tour 10',
    ])

    const searched = await asUserA(request(app).get('/api/venue-groups?q=12&limit=10')).expect(200)
    expect(searched.body.items.map((group) => group.name)).toEqual(['Tour 12'])
    await asUserA(request(app).get('/api/venue-groups?limit=0')).expect(400)
  })

  it('creates a group and exposes tenant-scoped group ids on venue rows', async () => {
    const created = await createGroup('Festivals').expect(201)
    expect(created.body).toMatchObject({
      group: { name: 'Festivals' },
      added_count: 1,
      already_present_count: 0,
    })

    const venues = await asUserA(request(app).get('/api/venues')).expect(200)
    expect(venues.body.find((venue) => venue.id === venueA().id).group_ids)
      .toEqual([created.body.group.id])
  })

  it('allows one venue in several groups but stores it only once per group', async () => {
    const first = await createGroup('North').expect(201)
    const second = await createGroup('Summer').expect(201)

    const repeated = await asUserA(
      request(app).post(`/api/venue-groups/${first.body.group.id}/members`)
        .send({ venue_ids: [venueA().id, venueA().id] }),
    ).expect(200)

    expect(repeated.body).toEqual({ added_count: 0, already_present_count: 1 })
    const { rows } = await pool.query(
      `SELECT group_id FROM venue_group_memberships
       WHERE tenant_id = $1 AND venue_id = $2 ORDER BY group_id`,
      [seed.tenantA.id, venueA().id],
    )
    expect(rows.map((row) => row.group_id)).toEqual([
      first.body.group.id,
      second.body.group.id,
    ])
  })

  it('renames, removes members from, and deletes a group without deleting venues', async () => {
    const created = await createGroup('Old name').expect(201)
    const groupId = created.body.group.id

    const renamed = await asUserA(
      request(app).patch(`/api/venue-groups/${groupId}`).send({ name: 'New name' }),
    ).expect(200)
    expect(renamed.body.name).toBe('New name')

    const removed = await asUserA(
      request(app).delete(`/api/venue-groups/${groupId}/members`).send({ venue_ids: [venueA().id] }),
    ).expect(200)
    expect(removed.body).toEqual({ removed_count: 1 })

    await asUserA(request(app).delete(`/api/venue-groups/${groupId}`)).expect(204)
    const { rows } = await pool.query('SELECT id FROM venues WHERE id = $1', [venueA().id])
    expect(rows).toHaveLength(1)
  })

  it('requires distinct non-empty group names within a tenant', async () => {
    await createGroup('  Touring  ').expect(201)
    const duplicate = await createGroup('touring').expect(409)
    expect(duplicate.body.code).toBe('venue_group_exists')
    await createGroup('   ').expect(400)

    await asUserB(
      request(app).post('/api/venue-groups').send({ name: 'TOURING', venue_ids: [venueB().id] }),
    ).expect(201)
  })

  it('rejects cross-tenant group and member writes as not found without partial changes', async () => {
    const groupA = await createGroup('Private A').expect(201)
    const groupId = groupA.body.group.id

    await asUserB(
      request(app).patch(`/api/venue-groups/${groupId}`).send({ name: 'Leaked' }),
    ).expect(404)
    await asUserB(
      request(app).post(`/api/venue-groups/${groupId}/members`).send({ venue_ids: [venueB().id] }),
    ).expect(404)
    await asUserA(
      request(app).post(`/api/venue-groups/${groupId}/members`).send({ venue_ids: [venueB().id] }),
    ).expect(404)

    const listB = await asUserB(request(app).get('/api/venue-groups')).expect(200)
    expect(listB.body.items).toEqual([])
    const { rows: [stored] } = await pool.query('SELECT name FROM venue_groups WHERE id = $1', [groupId])
    expect(stored.name).toBe('Private A')
  })

  it('rejects malformed membership batches and planning writes from readers', async () => {
    await asUserA(
      request(app).post('/api/venue-groups').send({ name: 'No members', venue_ids: [] }),
    ).expect(400)

    await pool.query(
      'UPDATE memberships SET role = $1 WHERE user_id = $2 AND tenant_id = $3',
      ['reader', seed.userA.id, seed.tenantA.id],
    )
    await createGroup('Reader group').expect(403)
  })
})
