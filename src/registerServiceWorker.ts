// A failed registration leaves `serviceWorker.ready` pending forever, so the
// failure has to be visible rather than silent — see usePushNotifications.
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('[sw] registration failed', err)
  }
}
