import './_envSetup.js'
// @vitest-environment node
import { vi, describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { Readable } from 'node:stream'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let mockStatObject, mockGetObject
let seed

// Both mounts of the same handler: the canonical tenants route and the legacy
// notifications alias the bell shipped with. Every case runs against both so the
// alias can never drift away from the route that owns the behavior.
const MOUNTS = [
  ['/api/tenants/:id/avatar', (tenantId) => `/api/tenants/${tenantId}/avatar`],
  ['/api/notifications/tenant-avatar/:tenantId (legacy alias)', (tenantId) => `/api/notifications/tenant-avatar/${tenantId}`],
]

beforeAll(async () => {
  // The route streams from object storage; keep storage out of the test loop
  // (only auth/ownership behavior is under test here).
  const avatar = Buffer.from('AVATAR')
  mockStatObject = vi.fn().mockResolvedValue({
    size: avatar.length,
    metaData: { 'content-type': 'image/png' },
  })
  mockGetObject = vi.fn().mockImplementation(async () => Readable.from([avatar]))
  vi.doMock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
    ...(await importOriginal()),
    statObject: (...args) => mockStatObject(...args),
    getObject: (...args) => mockGetObject(...args),
  }))

  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  await runMigrations()

  const appMod = await import('./_app.js')
  app = appMod.createTestApp()
}, 60000)

beforeEach(async () => {
  mockGetObject.mockClear()
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query(
    `UPDATE tenants SET avatar_path = 'tenants/' || id || '/avatar/profile.png' WHERE id = $1`,
    [seed.tenantB.id],
  )
})

afterAll(async () => {
  await pool.end()
})

function asUser(user) {
  return (req) => req.set('x-test-user-id', String(user.id))
}

describe.each(MOUNTS)('GET %s', (_label, url) => {
  it('streams the profile picture for any tenant the caller is an approved member of', async () => {
    const res = await asUser(seed.superUser)(request(app).get(url(seed.tenantB.id))).expect(200)
    expect(mockGetObject).toHaveBeenCalledWith(`tenants/${seed.tenantB.id}/avatar/profile.png`)
    expect(res.headers['content-type']).toContain('image/png')
  })

  it('streams the profile picture for a pending membership shown in settings', async () => {
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, source)
       VALUES ($1, $2, 'contributor', 'pending', 'invite')`,
      [seed.userA.id, seed.tenantB.id],
    )

    await asUser(seed.userA)(request(app).get(url(seed.tenantB.id))).expect(200)
  })

  it('404s for a tenant without a current membership (no existence leak)', async () => {
    await asUser(seed.userA)(request(app).get(url(seed.tenantB.id))).expect(404)
  })

  it('404s when the tenant has no profile picture', async () => {
    await asUser(seed.userA)(request(app).get(url(seed.tenantA.id))).expect(404)
  })

  it('400s on a non-numeric tenant id', async () => {
    await asUser(seed.userA)(request(app).get(url('abc'))).expect(400)
  })
})
