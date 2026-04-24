// @vitest-environment node
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'

describe('sendPushToMember', () => {
  let sendPushToMember
  let mockQuery
  let mockSendNotification

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = 'test_public'
    process.env.VAPID_PRIVATE_KEY = 'test_private'
    process.env.VAPID_SUBJECT = 'mailto:test@test.com'

    mockQuery = vi.fn()
    mockSendNotification = vi.fn().mockResolvedValue({})

    vi.resetModules()
    vi.doMock('web-push', () => ({
      default: {
        setVapidDetails: vi.fn(),
        sendNotification: mockSendNotification,
      },
    }))
    vi.doMock('../../server/db/index.js', () => ({
      default: { query: mockQuery },
    }))

    const mod = await import('../../server/utils/sendPush.js')
    sendPushToMember = mod.sendPushToMember
  })

  beforeEach(() => {
    mockQuery.mockReset()
    mockSendNotification.mockReset()
    mockSendNotification.mockResolvedValue({})
  })

  it('does not send when band member has no linked user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await sendPushToMember(99, { title: 'Test', body: 'Hello' })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })

  it('does not send when linked user has no push subscriptions', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
    await sendPushToMember(1, { title: 'Test', body: 'Hello' })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })

  it('sends to all subscriptions of the linked user', async () => {
    const SUB = { endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 5 }] })
      .mockResolvedValueOnce({ rows: [SUB] })
    await sendPushToMember(1, { title: 'Task assigned to you', body: 'Do the thing' })
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } },
      JSON.stringify({ title: 'Task assigned to you', body: 'Do the thing' })
    )
  })

  it('queries band_members with user_id IS NOT NULL to skip unlinked members', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await sendPushToMember(42, { title: 'Test' })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('user_id IS NOT NULL'),
      [42]
    )
  })

  it('removes stale subscriptions that return 410', async () => {
    const SUB = { endpoint: 'https://push.example.com/gone', p256dh: 'k', auth: 'a' }
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 5 }] })
      .mockResolvedValueOnce({ rows: [SUB] })
      .mockResolvedValueOnce({ rows: [] }) // DELETE query
    mockSendNotification.mockRejectedValueOnce({ statusCode: 410 })

    await sendPushToMember(1, { title: 'Test' })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM push_subscriptions'),
      [[SUB.endpoint]]
    )
  })
})
