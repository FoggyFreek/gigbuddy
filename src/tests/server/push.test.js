import './_envSetup.js'
// @vitest-environment node
import { vi, describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'

let pool, runMigrations, truncateAll, seedTwoTenants
let sendPushToTenant, sendPushToMember
let mockSendNotification
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

  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  await runMigrations()

  const pushMod = await import('../../../server/utils/sendPush.js')
  sendPushToTenant = pushMod.sendPushToTenant
  sendPushToMember = pushMod.sendPushToMember
})

beforeEach(async () => {
  mockSendNotification.mockClear()
  await truncateAll()
  seed = await seedTwoTenants()

  // Two subscriptions for tenant A's user, one for tenant B's user.
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES
       ($1, 'https://push.test/a-1', 'pa1', 'aa1'),
       ($1, 'https://push.test/a-2', 'pa2', 'aa2'),
       ($2, 'https://push.test/b-1', 'pb1', 'ab1')`,
    [seed.userA.id, seed.userB.id],
  )
})

afterAll(async () => {
  await pool.end()
})

describe('sendPushToTenant', () => {
  it('only fans out to subscriptions of approved members in the target tenant', async () => {
    await sendPushToTenant(seed.tenantA.id, { title: 'Hi A', body: 'body', tag: 't', url: '/gigs' })

    expect(mockSendNotification).toHaveBeenCalledTimes(2)
    const endpoints = mockSendNotification.mock.calls.map((c) => c[0].endpoint)
    expect(endpoints).toEqual(
      expect.arrayContaining(['https://push.test/a-1', 'https://push.test/a-2']),
    )
    expect(endpoints).not.toContain('https://push.test/b-1')
  })

  it('does not send to a user whose membership is not approved', async () => {
    await pool.query(
      `UPDATE memberships SET status = 'pending' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await sendPushToTenant(seed.tenantA.id, { title: 'X', body: 'y' })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })

  it('embeds tenantId and tenantSlug in the payload', async () => {
    await sendPushToTenant(seed.tenantA.id, { title: 'Hi', body: 'body' })
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1])
    expect(payload).toMatchObject({
      title: 'Hi',
      body: 'body',
      tenantId: seed.tenantA.id,
      tenantSlug: 'alpha',
    })
  })
})

describe('sendPushToMember', () => {
  it('only sends to that band_member when its tenant matches', async () => {
    await sendPushToMember(seed.memberA.id, seed.tenantA.id, { title: 'You', body: 'task' })
    expect(mockSendNotification).toHaveBeenCalledTimes(2)
    const endpoints = mockSendNotification.mock.calls.map((c) => c[0].endpoint)
    expect(endpoints.every((e) => e.startsWith('https://push.test/a-'))).toBe(true)
  })

  it('does not send when the (band_member, tenant) pair does not match', async () => {
    await sendPushToMember(seed.memberA.id, seed.tenantB.id, { title: 'X', body: 'y' })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })
})
