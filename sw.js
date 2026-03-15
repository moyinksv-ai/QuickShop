/* sw.js - QuickShop Service Worker v3.4
 *
 * Changes from v3.3:
 * - Cache list only includes files guaranteed to exist at deploy time
 * - Fetch handler now explicitly handles navigation requests (required by
 *   Chrome 144+ for PWA installability — SW must intercept navigations)
 * - Offline fallback returns cached index.html for all navigation failures
 * - Non-GET requests are passed through cleanly (no bare return)
 */

const CACHE_NAME = 'qs-cache-v4.5';

// Only cache files that are GUARANTEED to exist in every deployment.
// Any missing file causes cache.addAll() to abort the entire SW install,
// which silently breaks PWA installability (no beforeinstallprompt ever fires).
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/styless.css',
  '/appss.js',
  '/indexeddb_sync.js',
  '/share-catalog.js',
  '/inventory.js',
  '/catalog.js',
  '/qs-init.js',
  '/manifest.json',
  '/pwa-192.png',
  '/pwa-512.png'
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll fails atomically — if any URL returns non-200, install aborts.
      // Every URL above must exist in the deployment.
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(function () {
      // Claim all open clients immediately so new SW controls existing tabs
      return self.clients.claim();
    })
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Always pass through non-GET requests (POST, PUT, DELETE etc.)
  if (request.method !== 'GET') return;

  // Always pass through Supabase API calls — auth and data must be live
  if (request.url.includes('supabase.co') || request.url.includes('supabase.in')) return;

  // ── Navigation requests (page loads) ──────────────────────────────────────
  // Chrome 144+ requires the SW to handle navigate-mode requests for the site
  // to qualify as a PWA. Return cached index.html as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // ── All other GET requests: cache-first, network fallback ─────────────────
  event.respondWith(
    caches.match(request).then(function (cachedResponse) {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then(function (networkResponse) {
        // Dynamically cache product images from Supabase storage
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          request.url.match(/\.(jpg|jpeg|png|gif|webp)/i)
        ) {
          var cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, cloned);
          });
        }
        return networkResponse;
      }).catch(function () {
        // Network failed, not in cache — return nothing gracefully
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});
