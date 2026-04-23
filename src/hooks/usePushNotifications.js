import { useState, useEffect } from 'react'
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../api/push.js'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

function getInitialStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'loading'
}

export function usePushNotifications() {
  const [status, setStatus] = useState(getInitialStatus)

  useEffect(() => {
    if (status !== 'loading') return
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription()
      setStatus(existing ? 'subscribed' : 'unsubscribed')
    })
  }, [status])

  async function subscribe() {
    try {
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await getVapidPublicKey()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await saveSubscription(sub)
      setStatus('subscribed')
    } catch {
      setStatus(Notification.permission === 'denied' ? 'denied' : 'unsubscribed')
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await removeSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setStatus('unsubscribed')
    } catch {
      // leave status as-is
    }
  }

  return { status, subscribe, unsubscribe }
}
