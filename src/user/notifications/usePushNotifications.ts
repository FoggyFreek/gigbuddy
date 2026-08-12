import { useState, useEffect } from 'react'
import { getVapidPublicKey, saveSubscription, removeSubscription } from './push.ts'

export type PushStatus =
  | 'unsupported' | 'denied' | 'loading' | 'subscribed' | 'unsubscribed' | 'unavailable'

// `serviceWorker.ready` never settles when registration failed, so every wait
// on it is bounded — otherwise the UI sits in 'loading' forever.
const READY_TIMEOUT_MS = 10_000

export interface PushNotificationsResult {
  status: PushStatus
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer as ArrayBuffer
}

function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('service worker never became ready')), READY_TIMEOUT_MS)
  })
  return Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => clearTimeout(timer))
}

function getInitialStatus(): PushStatus {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'loading'
}

export function usePushNotifications(): PushNotificationsResult {
  const [status, setStatus] = useState<PushStatus>(getInitialStatus)

  useEffect(() => {
    if (status !== 'loading') return
    let cancelled = false
    serviceWorkerReady()
      .then((reg) => reg.pushManager.getSubscription())
      .then((existing) => {
        if (!cancelled) setStatus(existing ? 'subscribed' : 'unsubscribed')
      })
      .catch((err: unknown) => {
        console.error('[push] readiness check failed', err)
        if (!cancelled) setStatus('unavailable')
      })
    return () => { cancelled = true }
  }, [status])

  async function subscribe(): Promise<void> {
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'unsubscribed')
        return
      }
      const reg = await serviceWorkerReady()
      const { publicKey } = await getVapidPublicKey()
      if (!publicKey) throw new Error('VAPID public key not available')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await saveSubscription(sub)
      setStatus('subscribed')
    } catch (err) {
      console.error('[push] subscribe failed', err)
      setStatus(Notification.permission === 'denied' ? 'denied' : 'unsubscribed')
    }
  }

  async function unsubscribe(): Promise<void> {
    try {
      const reg = await serviceWorkerReady()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await removeSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setStatus('unsubscribed')
    } catch (err) {
      console.error('[push] unsubscribe failed', err)
    }
  }

  return { status, subscribe, unsubscribe }
}
