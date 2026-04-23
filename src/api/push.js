import { request } from './_client.js'

export const getVapidPublicKey = () => request('/api/push/vapid-public-key')

export const saveSubscription = (sub) =>
  request('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
  })

export const removeSubscription = (endpoint) =>
  request('/api/push/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
