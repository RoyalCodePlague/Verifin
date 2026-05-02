const CACHE_NAME = 'verifin-cache-v9';
const APP_SHELL = '/index.html';
const OFFLINE_FALLBACK = '<!doctype html><title>Verifin</title><p>Verifin is offline. Reconnect and try again.</p>';
const STATIC_ASSETS = [
  APP_SHELL,
  '/manifest.json',
  '/manifest-light.json',
  '/manifest-dark.json',
  '/site.webmanifest',
  '/favicomatic-LIGHT/favicon-16x16.png',
  '/favicomatic-LIGHT/favicon-32x32.png',
  '/favicomatic-LIGHT/favicon-96x96.png',
  '/favicomatic-LIGHT/favicon-128.png',
  '/favicomatic-LIGHT/favicon-196x196.png',
  '/favicomatic-LIGHT/favicon.ico',
  '/favicomatic-LIGHT/apple-touch-icon-57x57.png',
  '/favicomatic-LIGHT/apple-touch-icon-60x60.png',
  '/favicomatic-LIGHT/apple-touch-icon-72x72.png',
  '/favicomatic-LIGHT/apple-touch-icon-76x76.png',
  '/favicomatic-LIGHT/apple-touch-icon-114x114.png',
  '/favicomatic-LIGHT/apple-touch-icon-120x120.png',
  '/favicomatic-LIGHT/apple-touch-icon-144x144.png',
  '/favicomatic-LIGHT/apple-touch-icon-152x152.png',
  '/favicomatic-LIGHT/mstile-144x144.png',
  '/favicomatic-LIGHT/mstile-310x310.png',
  '/favicomatic-DARK/favicon-16x16.png',
  '/favicomatic-DARK/favicon-32x32.png',
  '/favicomatic-DARK/favicon-96x96.png',
  '/favicomatic-DARK/favicon-128.png',
  '/favicomatic-DARK/favicon-196x196.png',
  '/favicomatic-DARK/favicon.ico',
  '/favicomatic-DARK/apple-touch-icon-57x57.png',
  '/favicomatic-DARK/apple-touch-icon-60x60.png',
  '/favicomatic-DARK/apple-touch-icon-72x72.png',
  '/favicomatic-DARK/apple-touch-icon-76x76.png',
  '/favicomatic-DARK/apple-touch-icon-114x114.png',
  '/favicomatic-DARK/apple-touch-icon-120x120.png',
  '/favicomatic-DARK/apple-touch-icon-144x144.png',
  '/favicomatic-DARK/apple-touch-icon-152x152.png',
  '/favicomatic-DARK/mstile-144x144.png',
  '/favicomatic-DARK/mstile-310x310.png',
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
