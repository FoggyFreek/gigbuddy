self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const { title = 'gigBuddy', body = '', tag = 'default', url = '/' } = data
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(event.notification.data.url)
            return client.focus()
          }
        }
        return clients.openWindow(event.notification.data.url)
      })
  )
})
