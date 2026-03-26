// GhostLink Service Worker — network-first for HTML, cache-first for assets
const CACHE_NAME = 'ghostlink-v4.7.2';

// Install: skip waiting immediately to activate new SW
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: clean ALL old caches, then claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//  - API/WS/POST: never intercept
//  - Navigation (HTML): network-first (critical for updates!)
//  - Static assets (/assets/*): cache-first (hashed filenames = safe)
//  - Everything else: network-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API, WebSocket, or non-GET
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
    return;
  }

  // Navigation requests (HTML pages): ALWAYS network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/').then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Hashed assets (/assets/index-abc123.js): cache-first (safe — filename changes on rebuild)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (icons, manifest, etc): network-first
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'GhostLink', {
    body: data.body || 'New message from an agent',
    icon: '/ghostlink.png',
    badge: '/favicon.svg',
    tag: data.tag || 'ghostlink-notification',
    data: { url: data.url || '/' },
  }));
});

// Notification click: focus or open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(event.notification.data.url || '/');
    })
  );
});
