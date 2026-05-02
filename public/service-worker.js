const CACHE_NAME = 'verifin-cache-v8';
const APP_SHELL = '/index.html';
const OFFLINE_FALLBACK = '<!doctype html><title>Verifin</title><p>Verifin is offline. Reconnect and try again.</p>';
const STATIC_ASSETS = [
  APP_SHELL,
  '/manifest.json',
  '/Appicons/favicon-128.png',
  '/Appicons/favicon-196x196.png',
  '/Appicons/mstile-310x310.png',
  '/Appicons/apple-touch-icon-152x152.png',
  '/WebIcons/favicon-16x16.png',
  '/WebIcons/favicon-32x32.png',
  '/WebIcons/favicon-96x96.png',
  '/WebIcons/favicon-128.png',
  '/WebIcons/favicon-196x196.png',
  '/WebIcons/favicon.ico',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(() => {
            // Optional assets should not prevent installation.
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(APP_SHELL, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(APP_SHELL);
          return cached || new Response(OFFLINE_FALLBACK, {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        })
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(response => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        }).catch(async () => {
          const shell = await caches.match(APP_SHELL);
          if (request.destination === 'document' && shell) return shell;
          return new Response('', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
      )
    );
    return;
  }

  event.respondWith(fetch(request));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
