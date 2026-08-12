import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { insertProfile, isolateProfileIds } from './_bandProfileHelpers.js'

// Tagging a personal-workspace event with one of the artist's bands. The label
// has to survive every projection — including /api/me/*, which is the ONLY
// place a personal workspace's planning pages read from.

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed, personal, myBandId

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
  await isolateProfileIds(pool)

  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, owner_user_id)
     VALUES ('mine', 'My workspace', 'My workspace', 'personal', $1) RETURNING *`,
    [seed.userA.id],
  )
  personal = tenant
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [seed.userA.id, personal.id],
  )
  const profile = await insertProfile(pool, { name: 'Off Platform', createdBy: seed.userA.id })
  const { rows: [row] } = await pool.query(
    'INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2) RETURNING id',
    [personal.id, profile.id],
  )
  myBandId = row.id
})

afterAll(async () => pool.end())

const asArtist = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(personal.id))
const asBand = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserLevel = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', 'null')

const TODAY = '2099-01-01'
const EXPECTED_LABEL = { name: 'Off Platform', country_code: 'nl' }

const CREATORS = [
  {
    label: 'gig',
    path: '/api/gigs',
    body: { event_date: '2099-06-01', event_description: 'Linked gig' },
    read: (body) => body,
  },
  {
    label: 'rehearsal',
    path: '/api/rehearsals',
    body: { proposed_date: '2099-06-02' },
    read: (body) => body,
  },
  {
    label: 'band event',
    path: '/api/band-events',
    body: { title: 'Linked event', start_date: '2099-06-03' },
    read: (body) => body,
  },
]

describe('linking an event to a band', () => {
  it.each(CREATORS)('carries the band on a created $label', async ({ path, body, read }) => {
    const res = await asArtist(request(app).post(path).send({ ...body, my_band_id: myBandId })).expect(201)

    expect(read(res.body).my_band).toMatchObject({ id: myBandId, ...EXPECTED_LABEL })
  })

  it.each(CREATORS)('carries the band on a patched $label', async ({ path, body, read }) => {
    const created = await asArtist(request(app).post(path).send(body)).expect(201)
    expect(read(created.body).my_band).toBeNull()

    const id = read(created.body).id
    const patched = await asArtist(request(app).patch(`${path}/${id}`).send({ my_band_id: myBandId })).expect(200)
    expect(read(patched.body).my_band).toMatchObject({ id: myBandId })

    const cleared = await asArtist(request(app).patch(`${path}/${id}`).send({ my_band_id: null })).expect(200)
    expect(read(cleared.body).my_band).toBeNull()
  })

  it.each(CREATORS)('carries the band on a $label detail read', async ({ path, body, read }) => {
    const created = await asArtist(request(app).post(path).send({ ...body, my_band_id: myBandId })).expect(201)
    const id = read(created.body).id

    const res = await asArtist(request(app).get(`${path}/${id}`)).expect(200)
    expect(read(res.body).my_band).toMatchObject({ id: myBandId })
  })
})

describe('gating and isolation', () => {
  it('refuses the field in a band workspace', async () => {
    const res = await asBand(request(app).post('/api/gigs')
      .send({ event_date: '2099-06-01', event_description: 'x', my_band_id: myBandId })).expect(403)

    expect(res.body.code).toBe('tenant_kind_not_supported')
  })

  it('still allows an ordinary band gig with no band tag', async () => {
    await asBand(request(app).post('/api/gigs')
      .send({ event_date: '2099-06-01', event_description: 'x' })).expect(201)
  })

  it('404s a my_band_id belonging to another workspace', async () => {
    const other = await insertProfile(pool, { name: 'Theirs', website_key: 't.example', website_url: 'https://t.example' })
    const { rows: [foreign] } = await pool.query(
      'INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2) RETURNING id',
      [seed.tenantB.id, other.id],
    )

    await asArtist(request(app).post('/api/gigs')
      .send({ event_date: '2099-06-01', event_description: 'x', my_band_id: foreign.id })).expect(404)

    const { rowCount } = await pool.query('SELECT 1 FROM gigs WHERE tenant_id = $1', [personal.id])
    expect(rowCount).toBe(0)
  })

  it('400s a malformed my_band_id', async () => {
    const res = await asArtist(request(app).post('/api/gigs')
      .send({ event_date: '2099-06-01', event_description: 'x', my_band_id: 'abc' })).expect(400)
    expect(res.body.code).toBe('invalid_my_band_id')
  })
})

// A personal workspace's planning pages read the cross-tenant hub, not the
// active-tenant endpoints, so a label missing here is a label nobody ever sees.
describe('the cross-tenant hub', () => {
  beforeEach(async () => {
    for (const { path, body } of CREATORS) {
      await asArtist(request(app).post(path).send({ ...body, my_band_id: myBandId })).expect(201)
    }
  })

  // The hub's windowed read is /agenda; the per-type feeds are all bounded.
  const hubFeeds = [
    ['/api/me/gigs/upcoming', `?limit=10&today=${TODAY}`],
    ['/api/me/rehearsals/upcoming', `?limit=10&today=${TODAY}`],
    ['/api/me/band-events/upcoming', `?limit=10&today=${TODAY}`],
  ]

  it.each(hubFeeds)('labels the rows of %s', async (path, qs) => {
    const res = await asUserLevel(request(app).get(`${path}${qs}`)).expect(200)

    expect(res.body.items.length).toBeGreaterThan(0)
    res.body.items.forEach((row) => expect(row.my_band).toMatchObject({ id: myBandId, ...EXPECTED_LABEL }))
  })

  // agendaItem builds a fresh object field by field, so anything the
  // projections add is dropped unless it is named there.
  it('labels agenda rows, which are built field by field', async () => {
    const res = await asUserLevel(
      request(app).get('/api/me/agenda?from=2099-01-01&to=2099-12-31'),
    ).expect(200)

    expect(res.body.items).toHaveLength(3)
    res.body.items.forEach((item) => expect(item.myBand).toMatchObject({ id: myBandId, name: 'Off Platform' }))
  })

  it('labels past feeds too', async () => {
    await pool.query(`UPDATE gigs SET event_date = '2020-01-01' WHERE tenant_id = $1`, [personal.id])

    const res = await asUserLevel(
      request(app).get(`/api/me/gigs/past?limit=10&today=${TODAY}`),
    ).expect(200)

    expect(res.body.items[0].my_band).toMatchObject({ id: myBandId })
  })

  // Search returns a bare array rather than the collection envelope.
  it('labels search hits', async () => {
    const res = await asUserLevel(request(app).get('/api/me/gigs/search?q=Linked')).expect(200)
    expect(res.body[0].my_band).toMatchObject({ id: myBandId })
  })

  it('leaves band-tenant rows unlabelled', async () => {
    // Created through the API so the caller's lead roster member is added as a
    // participant — without one, the hub's band-side scope filters the row out.
    await asBand(request(app).post('/api/gigs')
      .send({ event_date: '2099-07-01', event_description: 'Band gig' })).expect(201)

    const res = await asUserLevel(
      request(app).get('/api/me/agenda?from=2000-01-01&to=2099-12-31'),
    ).expect(200)

    const bandRows = res.body.items.filter((item) => item.tenantId === seed.tenantA.id)
    expect(bandRows.length).toBeGreaterThan(0)
    bandRows.forEach((item) => expect(item.myBand).toBeNull())
  })
})
