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

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

describe('band member roles', () => {
  it('creates and returns roles in the requested order', async () => {
    const res = await asUserA(
      request(app).post('/api/band-members').send({
        name: 'Robin',
        roles: ['Lead Vocals', 'Lead Guitar'],
      }),
    ).expect(201)

    expect(res.body.roles).toEqual(['Lead Vocals', 'Lead Guitar'])

    const listed = await asUserA(request(app).get('/api/band-members')).expect(200)
    expect(listed.body.find((member) => member.id === res.body.id).roles)
      .toEqual(['Lead Vocals', 'Lead Guitar'])
  })

  it('rejects unknown and duplicate roles', async () => {
    await asUserA(
      request(app).post('/api/band-members').send({
        name: 'Robin',
        roles: ['Lead Vocals', 'Kazoo'],
      }),
    ).expect(400)

    await asUserA(
      request(app).patch(`/api/band-members/${seed.memberA.id}`).send({
        roles: ['Drums', 'Drums'],
      }),
    ).expect(400)
  })

  it('does not update roles for a member in another tenant', async () => {
    await asUserA(
      request(app).patch(`/api/band-members/${seed.memberB.id}`).send({
        roles: ['Drums'],
      }),
    ).expect(404)

    const { rows } = await pool.query(
      'SELECT roles FROM band_members WHERE id = $1',
      [seed.memberB.id],
    )
    expect(rows[0].roles).toEqual([])
  })
})
