import './_envSetup.js'
// @vitest-environment node
import { vi, describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { Readable } from 'node:stream'
import { PERMISSIONS } from '../../../shared/permissions.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let dispatchNotification
let mockSendNotification, mockStatObject, mockGetObject
let seed

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = 'test_public'
  process.env.VAPID_PRIVATE_KEY = 'test_private'
  process.env.VAPID_SUBJECT = 'mailto:test@test.com'

  mockSendNotification = vi.fn().mockResolvedValue({})
  vi.doMock('web-push', () => ({
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: mockSendNotification,
    },
  }))

  // The tenant-avatar route streams from object storage; keep storage out of the
  // test loop (only auth/ownership behavior is under test here).
  mockStatObject = vi.fn().mockResolvedValue({ size: 4, metaData: { 'content-type': 'image/png' } })
  mockGetObject = vi.fn().mockImplementation(async () => Readable.from(['AVATAR']))
  vi.doMock('../../../server/services/storageService.js', async (importOriginal) => ({
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

  const svc = await import('../../../server/services/notificationService.js')
  dispatchNotification = svc.dispatchNotification
}, 60000)

beforeEach(async () => {
  mockSendNotification.mockClear()
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUser(user) {
  return (req) => req.set('x-test-user-id', String(user.id))
}

async function addUserInTenant(email, tenantId, role) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status)
     VALUES ($1, $1, $1, 'approved') RETURNING id, email`,
    [email],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, $2, $3, 'approved', NOW())`,
    [user.id, tenantId, role],
  )
  return user
}

async function rowsForUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  )
  return rows
}

const gigNew = (overrides = {}) => ({
  tenantId: seed.tenantA.id,
  type: 'gig-new',
  title: 'New gig option',
  body: 'Venue · 2026-09-01',
  url: '/gigs',
  sourceType: 'gig',
  sourceId: 1,
  ...overrides,
})

describe('dispatchNotification — fan-out', () => {
  it('persists one row per approved member of the tenant and none cross-tenant', async () => {
    await dispatchNotification(gigNew())

    const a = await rowsForUser(seed.userA.id)
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({
      tenant_id: seed.tenantA.id,
      type: 'gig-new',
      title: 'New gig option',
      url: '/gigs',
      source_type: 'gig',
      read_at: null,
    })
    // super admin holds an approved membership in tenant A too
    expect(await rowsForUser(seed.superUser.id)).toHaveLength(1)
    // tenant B's user must not receive tenant A fan-out (isolation)
    expect(await rowsForUser(seed.userB.id)).toHaveLength(0)
  })

  it('does not persist for non-approved memberships', async () => {
    await pool.query(
      `UPDATE memberships SET status = 'pending' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await dispatchNotification(gigNew())
    expect(await rowsForUser(seed.userA.id)).toHaveLength(0)
  })

  it('rows exist as soon as dispatch resolves (persistence is awaited)', async () => {
    await dispatchNotification(gigNew())
    expect(await rowsForUser(seed.userA.id)).toHaveLength(1)
  })

  it('pushes only to audience users, tagging the payload with the type', async () => {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES
         ($1, 'https://push.test/a-1', 'p', 'a'),
         ($2, 'https://push.test/b-1', 'p', 'a')`,
      [seed.userA.id, seed.userB.id],
    )
    await dispatchNotification(gigNew())

    await vi.waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1))
    expect(mockSendNotification.mock.calls[0][0].endpoint).toBe('https://push.test/a-1')
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1])
    expect(payload).toMatchObject({
      title: 'New gig option',
      tag: 'gig-new',
      url: '/gigs',
      tenantId: seed.tenantA.id,
      tenantSlug: 'alpha',
    })
  })

  it('skips users who disabled the type (rows and push)', async () => {
    await pool.query(
      `INSERT INTO notification_type_prefs (user_id, type, enabled) VALUES ($1, 'gig-new', false)`,
      [seed.userA.id],
    )
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, 'https://push.test/a-1', 'p', 'a')`,
      [seed.userA.id],
    )
    await dispatchNotification(gigNew())

    expect(await rowsForUser(seed.userA.id)).toHaveLength(0)
    expect(await rowsForUser(seed.superUser.id)).toHaveLength(1)
    // other types still get through
    await dispatchNotification(gigNew({ type: 'gig-confirmed', title: 'Gig confirmed!' }))
    expect(await rowsForUser(seed.userA.id)).toHaveLength(1)
  })

  it('skips users who disabled the tenant, but only for that tenant', async () => {
    await pool.query(
      `INSERT INTO notification_tenant_prefs (user_id, tenant_id, enabled) VALUES ($1, $2, false)`,
      [seed.superUser.id, seed.tenantA.id],
    )
    await dispatchNotification(gigNew())
    await dispatchNotification(gigNew({ tenantId: seed.tenantB.id }))

    const rows = await rowsForUser(seed.superUser.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].tenant_id).toBe(seed.tenantB.id)
  })

  it('targets a single member via bandMemberId, tenant-matched', async () => {
    await dispatchNotification(gigNew({
      type: 'task-assigned',
      title: 'Task assigned to you',
      url: '/tasks',
      bandMemberId: seed.memberA.id,
    }))
    expect(await rowsForUser(seed.userA.id)).toHaveLength(1)
    expect(await rowsForUser(seed.superUser.id)).toHaveLength(0)

    // mismatched (band_member, tenant) pair → nothing
    await truncateAll()
    seed = await seedTwoTenants()
    await dispatchNotification(gigNew({
      tenantId: seed.tenantB.id,
      type: 'task-assigned',
      bandMemberId: seed.memberA.id,
    }))
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM notifications')
    expect(rows[0].n).toBe(0)
  })

  it('restricts the audience by requiredPermission, super admins exempt from role check', async () => {
    const contrib = await addUserInTenant('contrib@test.local', seed.tenantA.id, 'contributor')
    // demote super admin's membership role — is_super_admin must still pass
    await pool.query(
      `UPDATE memberships SET role = 'contributor' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.superUser.id, seed.tenantA.id],
    )

    await dispatchNotification(gigNew({
      type: 'invoice-paid',
      title: 'Invoice paid',
      body: '2026-001 · Customer · €100,00',
      url: '/invoices/1',
      requiredPermission: PERMISSIONS.FINANCE_VIEW,
    }))

    expect(await rowsForUser(seed.userA.id)).toHaveLength(1)      // tenant_admin
    expect(await rowsForUser(seed.superUser.id)).toHaveLength(1)  // super admin
    expect(await rowsForUser(contrib.id)).toHaveLength(0)         // no finance.view
  })

  it('prunes the audience users’ rows older than 90 days on dispatch', async () => {
    await pool.query(
      `INSERT INTO notifications (user_id, tenant_id, type, title, url, created_at)
       VALUES ($1, $2, 'gig-new', 'Old', '/gigs', NOW() - INTERVAL '100 days')`,
      [seed.userA.id, seed.tenantA.id],
    )
    await dispatchNotification(gigNew())
    const rows = await rowsForUser(seed.userA.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('New gig option')
  })
})

describe('GET /api/notifications', () => {
  it('returns only own rows, newest first, with tenant name/profile picture and unreadCount', async () => {
    await pool.query(`UPDATE tenants SET avatar_path = 'tenants/' || id || '/avatar/profile.png'`)
    await dispatchNotification(gigNew())
    await dispatchNotification(gigNew({
      tenantId: seed.tenantB.id, type: 'gig-confirmed', title: 'Gig confirmed!',
    }))

    const res = await asUser(seed.superUser)(request(app).get('/api/notifications')).expect(200)
    expect(res.body.unreadCount).toBe(2)
    expect(res.body.notifications).toHaveLength(2)
    expect(res.body.notifications[0]).toMatchObject({
      title: 'Gig confirmed!',
      tenantId: seed.tenantB.id,
      tenantName: 'Beta Band',
      tenantAvatarPath: `tenants/${seed.tenantB.id}/avatar/profile.png`,
      readAt: null,
    })

    const resA = await asUser(seed.userA)(request(app).get('/api/notifications')).expect(200)
    expect(resA.body.notifications).toHaveLength(1)
    expect(resA.body.notifications[0].tenantId).toBe(seed.tenantA.id)
  })

  it('prunes rows older than 90 days for the requesting user', async () => {
    await pool.query(
      `INSERT INTO notifications (user_id, tenant_id, type, title, url, created_at)
       VALUES ($1, $2, 'gig-new', 'Ancient', '/gigs', NOW() - INTERVAL '100 days')`,
      [seed.userA.id, seed.tenantA.id],
    )
    const res = await asUser(seed.userA)(request(app).get('/api/notifications')).expect(200)
    expect(res.body.notifications).toHaveLength(0)
    expect(await rowsForUser(seed.userA.id)).toHaveLength(0)
  })

  it('requires an authenticated user', async () => {
    await request(app).get('/api/notifications').expect(401)
  })
})

describe('read / read-all / delete', () => {
  let notifId

  beforeEach(async () => {
    await dispatchNotification(gigNew())
    notifId = (await rowsForUser(seed.userA.id))[0].id
  })

  it('marks a single notification read', async () => {
    await asUser(seed.userA)(request(app).post(`/api/notifications/${notifId}/read`)).expect(204)
    const rows = await rowsForUser(seed.userA.id)
    expect(rows[0].read_at).not.toBeNull()

    const res = await asUser(seed.userA)(request(app).get('/api/notifications')).expect(200)
    expect(res.body.unreadCount).toBe(0)
  })

  it('marks all read', async () => {
    await dispatchNotification(gigNew({ type: 'gig-confirmed', title: 'Gig confirmed!' }))
    await asUser(seed.userA)(request(app).post('/api/notifications/read-all')).expect(204)
    const res = await asUser(seed.userA)(request(app).get('/api/notifications')).expect(200)
    expect(res.body.unreadCount).toBe(0)
    expect(res.body.notifications.every((n) => n.readAt !== null)).toBe(true)
  })

  it('deletes a notification', async () => {
    await asUser(seed.userA)(request(app).delete(`/api/notifications/${notifId}`)).expect(204)
    expect(await rowsForUser(seed.userA.id)).toHaveLength(0)
  })

  it("404s another user's notification id without leaking existence", async () => {
    await asUser(seed.userB)(request(app).post(`/api/notifications/${notifId}/read`)).expect(404)
    await asUser(seed.userB)(request(app).delete(`/api/notifications/${notifId}`)).expect(404)
    expect(await rowsForUser(seed.userA.id)).toHaveLength(1)
    expect((await rowsForUser(seed.userA.id))[0].read_at).toBeNull()
  })

  it('400s an invalid id', async () => {
    await asUser(seed.userA)(request(app).delete('/api/notifications/abc')).expect(400)
  })
})

describe('preferences', () => {
  it('defaults everything enabled with zero pref rows', async () => {
    const res = await asUser(seed.superUser)(request(app).get('/api/notifications/prefs')).expect(200)
    expect(res.body.types.length).toBeGreaterThanOrEqual(7)
    expect(res.body.types.every((t) => t.enabled)).toBe(true)
    expect(res.body.types.map((t) => t.type)).toContain('gig-new')
    expect(res.body.tenants).toHaveLength(2)
    expect(res.body.tenants.every((t) => t.enabled)).toBe(true)
    expect(res.body.tenants[0]).toHaveProperty('tenantName')
    expect(res.body.tenants[0]).toHaveProperty('avatarPath')
  })

  it('exposes the band profile picture path', async () => {
    await pool.query(
      `UPDATE tenants SET avatar_path = 'tenants/' || id || '/avatar/profile.png' WHERE id = $1`,
      [seed.tenantA.id],
    )
    const res = await asUser(seed.userA)(request(app).get('/api/notifications/prefs')).expect(200)
    expect(res.body.tenants.find((t) => t.tenantId === seed.tenantA.id).avatarPath)
      .toBe(`tenants/${seed.tenantA.id}/avatar/profile.png`)
  })

  it('persists partial updates and reflects them on GET', async () => {
    await asUser(seed.userA)(
      request(app).put('/api/notifications/prefs').send({
        types: [{ type: 'gig-new', enabled: false }],
        tenants: [{ tenantId: seed.tenantA.id, enabled: false }],
      }),
    ).expect(200)

    const res = await asUser(seed.userA)(request(app).get('/api/notifications/prefs')).expect(200)
    expect(res.body.types.find((t) => t.type === 'gig-new').enabled).toBe(false)
    expect(res.body.types.find((t) => t.type === 'gig-confirmed').enabled).toBe(true)
    expect(res.body.tenants.find((t) => t.tenantId === seed.tenantA.id).enabled).toBe(false)

    // re-enabling flips it back
    await asUser(seed.userA)(
      request(app).put('/api/notifications/prefs').send({
        types: [{ type: 'gig-new', enabled: true }],
      }),
    ).expect(200)
    const res2 = await asUser(seed.userA)(request(app).get('/api/notifications/prefs')).expect(200)
    expect(res2.body.types.find((t) => t.type === 'gig-new').enabled).toBe(true)
  })

  it('rejects an unknown type with 400', async () => {
    await asUser(seed.userA)(
      request(app).put('/api/notifications/prefs').send({
        types: [{ type: 'nonsense', enabled: false }],
      }),
    ).expect(400)
  })

  it("404s a tenant the caller has no approved membership in", async () => {
    await asUser(seed.userA)(
      request(app).put('/api/notifications/prefs').send({
        tenants: [{ tenantId: seed.tenantB.id, enabled: false }],
      }),
    ).expect(404)
  })
})

describe('GET /api/notifications/tenant-avatar/:tenantId', () => {
  beforeEach(async () => {
    await pool.query(
      `UPDATE tenants SET avatar_path = 'tenants/' || id || '/avatar/profile.png' WHERE id = $1`,
      [seed.tenantB.id],
    )
  })

  it('streams the profile picture for any tenant the caller is an approved member of', async () => {
    const res = await asUser(seed.superUser)(
      request(app).get(`/api/notifications/tenant-avatar/${seed.tenantB.id}`),
    ).expect(200)
    expect(mockGetObject).toHaveBeenCalledWith(`tenants/${seed.tenantB.id}/avatar/profile.png`)
    expect(res.headers['content-type']).toContain('image/png')
  })

  it('404s for a tenant without approved membership (no existence leak)', async () => {
    await asUser(seed.userA)(
      request(app).get(`/api/notifications/tenant-avatar/${seed.tenantB.id}`),
    ).expect(404)
  })

  it('404s when the tenant has no profile picture', async () => {
    await asUser(seed.userA)(
      request(app).get(`/api/notifications/tenant-avatar/${seed.tenantA.id}`),
    ).expect(404)
  })
})
