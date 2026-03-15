/* sw.js - QuickShop Service Worker v3.3 (Production Build) */

const CACHE_NAME = 'qs-cache-v4.4';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/styless.css',
  '/appss.js',
  '/indexeddb_sync.js',
  '/share-catalog.js',
  '/inventory.js',
  '/qs-init.js',
  '/manifest.json',
  'pwa-192.png',
  'pwa-512.png'
  // NOTE: supabase-config.js is intentionally NOT cached here.
  // It is generated at build time by build.sh and does not exist as a
  // static file in the repo. If it were listed here, cache.addAll() would
  // throw on first SW install (one failed URL aborts the entire install),
  // which silently breaks PWA installability and prevents the browser from
  // ever firing beforeinstallprompt.
  //
  // CDN scripts (zxing, chart.js, supabase-js) are also excluded:
  //   - @latest/@2 tags can resolve differently over time and fail
  //   - They are large and fast to re-fetch on reconnect
  //   - The app's core offline functionality (IndexedDB, localStorage)
  //     works without them
];

// Install: Populate cache
// Using {ignoreSearch: false} default — exact URL matching only.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy: Cache-first for app shell, network-first for API calls
self.addEventListener('fetch', (event) => {
  // Skip non-GET and Supabase API calls (auth + data must always be live)
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Dynamically cache product images
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.url.match(/\.(jpg|jpeg|png|gif|webp)/)
        ) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return networkResponse;
      }).catch(() => {
        // Network failed and not in cache — return nothing gracefully
      });

      return cachedResponse || fetchPromise;
    })
  );
});
