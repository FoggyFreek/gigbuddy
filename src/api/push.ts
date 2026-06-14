import { request } from './_client.ts'

interface VapidKey {
  publicKey?: string
}

interface PushSubscriptionKeys {
  p256dh?: string
  auth?: string
}

interface PushSubscription {
  endpoint: string
  toJSON(): { keys?: PushSubscriptionKeys }
}

export const getVapidPublicKey = () => request<VapidKey>('/api/push/vapid-public-key')

export const saveSubscription = (sub: PushSubscription) =>
  request<void>('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
  })

export const removeSubscription = (endpoint: string) =>
  request<void>('/api/push/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
