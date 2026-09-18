/*
 * Service worker for the CUBE Messages app: receives web push notifications
 * (a new text, a missed call, a voicemail) and opens the right thread when
 * one is tapped. No caching — the app always loads live.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'CUBE Messages'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'cube-messages',
    renotify: true,
    data: { url: data.url || '/messages' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/messages'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).pathname.startsWith('/messages') && 'focus' in c) { c.navigate(url); return c.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
