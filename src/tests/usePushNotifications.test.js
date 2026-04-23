import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/push.js', () => ({
  getVapidPublicKey: vi.fn(),
  saveSubscription: vi.fn(),
  removeSubscription: vi.fn(),
}))

import { usePushNotifications } from '../hooks/usePushNotifications.js'
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
} from '../api/push.js'

// Valid base64url for urlBase64ToUint8Array: 65 bytes of zeros encoded.
const VAPID_KEY = 'A'.repeat(86) + '='

function setupNavigator({ permission = 'default', existingSub = null } = {}) {
  const subscribe = vi.fn().mockResolvedValue({
    endpoint: 'https://push.example/new',
    toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  })
  const getSubscription = vi.fn().mockResolvedValue(existingSub)
  const registration = { pushManager: { subscribe, getSubscription } }

  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { ready: Promise.resolve(registration) } },
    configurable: true,
  })
  globalThis.PushManager = function () {}
  globalThis.Notification = {
    permission,
    requestPermission: vi.fn().mockImplementation(async () => globalThis.Notification.permission),
  }
  return { subscribe, getSubscription, registration }
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete globalThis.PushManager
    delete globalThis.Notification
  })

  it('returns unsupported when serviceWorker is missing', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    })
    globalThis.PushManager = function () {}
    globalThis.Notification = { permission: 'default' }

    const { result } = renderHook(() => usePushNotifications())
    expect(result.current.status).toBe('unsupported')
  })

  it('returns denied when Notification permission is denied', () => {
    setupNavigator({ permission: 'denied' })
    const { result } = renderHook(() => usePushNotifications())
    expect(result.current.status).toBe('denied')
  })

  it('transitions to unsubscribed when no existing subscription', async () => {
    setupNavigator({ existingSub: null })
    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
  })

  it('transitions to subscribed when an existing subscription is present', async () => {
    setupNavigator({ existingSub: { endpoint: 'https://push.example/old' } })
    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('subscribed'))
  })

  it('subscribe() creates a subscription and posts it to the server', async () => {
    const { subscribe: pmSubscribe } = setupNavigator({ permission: 'granted' })
    getVapidPublicKey.mockResolvedValue({ publicKey: VAPID_KEY })
    saveSubscription.mockResolvedValue({ ok: true })

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))

    await act(async () => { await result.current.subscribe() })

    expect(globalThis.Notification.requestPermission).toHaveBeenCalled()
    expect(getVapidPublicKey).toHaveBeenCalled()
    expect(pmSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )
    expect(saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/new' }),
    )
    expect(result.current.status).toBe('subscribed')
  })

  it('subscribe() falls back to unsubscribed on network failure', async () => {
    setupNavigator({ permission: 'granted' })
    getVapidPublicKey.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { await result.current.subscribe() })

    expect(result.current.status).toBe('unsubscribed')
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('subscribe() sets denied when the permission prompt is blocked', async () => {
    setupNavigator({ permission: 'default' })

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))

    globalThis.Notification.permission = 'denied'
    await act(async () => { await result.current.subscribe() })

    expect(result.current.status).toBe('denied')
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(saveSubscription).not.toHaveBeenCalled()
  })

  it('subscribe() stays unsubscribed when the permission prompt is dismissed', async () => {
    setupNavigator({ permission: 'default' })

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))

    await act(async () => { await result.current.subscribe() })

    expect(result.current.status).toBe('unsubscribed')
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(saveSubscription).not.toHaveBeenCalled()
  })

  it('unsubscribe() removes the subscription server-side and locally', async () => {
    const unsubscribeMock = vi.fn().mockResolvedValue(true)
    const existingSub = {
      endpoint: 'https://push.example/old',
      unsubscribe: unsubscribeMock,
    }
    const { getSubscription } = setupNavigator({ existingSub })
    removeSubscription.mockResolvedValue(null)

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => { await result.current.unsubscribe() })

    expect(getSubscription).toHaveBeenCalled()
    expect(removeSubscription).toHaveBeenCalledWith('https://push.example/old')
    expect(unsubscribeMock).toHaveBeenCalled()
    expect(result.current.status).toBe('unsubscribed')
  })

  it('unsubscribe() is a no-op when there is no active subscription', async () => {
    setupNavigator({ existingSub: null })

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))

    await act(async () => { await result.current.unsubscribe() })
    expect(removeSubscription).not.toHaveBeenCalled()
    expect(result.current.status).toBe('unsubscribed')
  })
})
