// Input parsing and validation for push routes. No DB access here.

// Validates a push subscription body. Returns { error } when required parts are
// missing, otherwise the normalized { endpoint, p256dh, auth } (plus oldEndpoint
// when present, used by resubscribe).
export function parseSubscription(body) {
  const { endpoint, keys, oldEndpoint } = body || {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return { error: 'endpoint and keys (p256dh, auth) are required' }
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth, oldEndpoint: oldEndpoint ?? null }
}
