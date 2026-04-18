// Cache static app assets, but always let API requests go to the network.
const CACHE_NAME = 'verifin-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(() => {
            // Optional assets should not prevent the service worker from installing.
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for static assets
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(response => {
        return response || fetch(request).then(fetchRes => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(request, fetchRes.clone());
            return fetchRes;
          });
        });
      })
    );
    return;
  }

  // Network-first for everything else (API, dynamic)
  event.respondWith(
    fetch(request)
      .then(response => response)
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match('/index.html');
      })
  );
});

// Listen for skipWaiting message to activate new SW immediately
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
