const CACHE_NAME = 'mac-v4';
const ASSETS = [
  '/',
  '/static/style.css',
  '/static/app.js',
  '/static/js/auth.js',
  '/static/js/i18n.js',
  '/manifest.json',
  '/static/favicon.ico',
  '/static/icon-192.png',
  '/static/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  if (url.pathname.startsWith('/static/libs/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  );
});

/* ── Push Notifications ─────────────────────────────────── */
self.addEventListener('push', e => {
  let data = { title: 'MAC Notification', body: 'You have a new notification', icon: '/static/icon-192.png' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag: data.tag || 'mac-notif',
      data: { url: data.url || data.link || '/' },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then(c => c.navigate(url));
        }
      }
      return clients.openWindow(url);
    })
  );
});
