import { useState, useEffect } from 'react'
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../api/push.ts'

export type PushStatus = 'unsupported' | 'denied' | 'loading' | 'subscribed' | 'unsubscribed'

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

function getInitialStatus(): PushStatus {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'loading'
}

export function usePushNotifications(): PushNotificationsResult {
  const [status, setStatus] = useState<PushStatus>(getInitialStatus)

  useEffect(() => {
    if (status !== 'loading') return
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription()
      setStatus(existing ? 'subscribed' : 'unsubscribed')
    })
  }, [status])

  async function subscribe(): Promise<void> {
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'unsubscribed')
        return
      }
      const reg = await navigator.serviceWorker.ready
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
      const reg = await navigator.serviceWorker.ready
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
