function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

self.addEventListener('push', (event) => {
  let data = {}
  if (event.data) {
    try { data = event.data.json() }
    catch { data = { body: event.data.text() } }
  }
  const { title = 'gigBuddy', body = '', tag = 'default', url = '/' } = data
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: new URL('/icons/icon-192.png', self.location.origin).href,
      badge: new URL('/icons/badge-72.png', self.location.origin).href,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windowClients) {
      if ('focus' in client) {
        if (client.url !== target) {
          await client.navigate(target).catch(() => {})
        }
        return client.focus()
      }
    }
    return clients.openWindow(target)
  })())
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      let sub = event.newSubscription
      if (!sub) {
        const res = await fetch('/api/push/vapid-public-key', { credentials: 'include' })
        if (!res.ok) return
        const { publicKey } = await res.json()
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
      await fetch('/api/push/resubscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint: event.oldSubscription?.endpoint,
          endpoint: sub.endpoint,
          keys: sub.toJSON().keys,
        }),
      })
    } catch {
      // Best-effort — user will be prompted to re-enable on next visit.
    }
  })())
})
