/**
 * MP3 Splitter Service Worker
 * Adheres strictly to PWA Standards & WebAPK Isolation Rules
 */

const CACHE_NAME = 'mp3-splitter-v28';

const PRECACHE_ASSETS = [
  './',
  './index.html?v=28',
  './styles.css?v=28',
  './app.js?v=28',
  './mp3-worker.js?v=28',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg',
  './icons/favicon.png',
];

// Install: precache application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: purge stale caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: scoped cache-first strategy with network fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Ignore blob:, data:, and browser extension URLs
  if (
    requestUrl.protocol === 'blob:' ||
    requestUrl.protocol === 'data:' ||
    requestUrl.protocol.startsWith('chrome')
  ) {
    return;
  }

  // Scope Isolation: Never intercept requests outside this PWA scope on the same origin
  if (
    requestUrl.origin === self.location.origin &&
    !event.request.url.startsWith(self.registration.scope)
  ) {
    return;
  }

  // Navigation request (SPA fallback within scope)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedIndex =
          (await caches.match('./index.html', { ignoreSearch: true })) ||
          (await caches.match('./', { ignoreSearch: true }));
        return cachedIndex || Response.error();
      })
    );
    return;
  }

  // Cache-first for all precached assets with query-ignoring match for offline resilience
  event.respondWith(
    caches
      .match(event.request, { ignoreSearch: true })
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          // Cache successful responses within scope
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic' &&
            requestUrl.href.startsWith(self.registration.scope)
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
      .catch(() => {
        // Fallback for failed asset loads when offline
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});

// Message handler for in-app update trigger
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
