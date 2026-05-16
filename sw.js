/* sw.js — QuickShop Service Worker v4.0
 *
 * ARCHITECTURE: Runtime-first caching (no precache list)
 * ─────────────────────────────────────────────────────
 * Previous versions tried to cache a list of files on install.
 * If any single file failed (network hiccup, Vercel cold start,
 * missing file), the entire SW install aborted silently — the app
 * never qualified as installable and beforeinstallprompt never fired.
 *
 * This version caches nothing on install. Instead, every file is
 * cached the first time it's fetched (runtime caching). The app
 * becomes fully offline-capable after the first complete page load.
 * SW install can never fail because there is nothing to pre-fetch.
 *
 * STRATEGIES PER RESOURCE TYPE:
 * ─────────────────────────────────────────────────────
 *  App shell (HTML, JS, CSS, icons, manifest)
 *    → Stale-while-revalidate: serve from cache instantly, update
 *      in background. User always gets fast load. New version
 *      activates on next page open.
 *
 *  Product images (jpg, jpeg, png, gif, webp, avif)
 *    → Cache-first: images never change once uploaded to Supabase
 *      storage. Serve from cache forever, only fetch if not cached.
 *
 *  Supabase API + auth (supabase.co)
 *    → Network-only: auth and data must always be live. Never cache.
 *
 *  Navigation requests (page loads)
 *    → Network-first with cache fallback to index.html.
 *      Ensures the app opens offline after first visit.
 */

var CACHE_NAME    = 'qs-v5.9.9.9.8';
var IMAGE_CACHE   = 'qs-images-v4.0';
/* ── Install ─────────────────────────────────────────────────────────────────
 * Nothing to pre-cache. Skip waiting so this SW activates immediately
 * without waiting for existing tabs to close. */
self.addEventListener('install', function () {
  self.skipWaiting();
});

/* ── Activate ────────────────────────────────────────────────────────────────
 * Delete every cache that doesn't match our current names.
 * Claim all clients so this SW controls existing tabs immediately. */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME && key !== IMAGE_CACHE;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ── Fetch ───────────────────────────────────────────────────────────────────*/
self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url     = request.url;

  /* 1. Non-GET — pass through untouched */
  if (request.method !== 'GET') return;

  /* 2. Supabase API / auth / realtime — always network, never cache.
   *    EXCEPTION: Supabase Storage image URLs (/storage/v1/object/public/)
   *    are permanent CDN URLs that never change after upload. These must be
   *    allowed through to the cache-first image handler below (rule 5).
   *    Without this exception, all product photos go network-only and the
   *    catalog cannot display images offline. */
  var isSupabase = url.includes('supabase.co') || url.includes('supabase.in');
  var isSupabaseStorage = isSupabase && url.includes('/storage/v1/object/');
  if (isSupabase && !isSupabaseStorage) return; // API/auth/realtime only

  /* 3. Chrome extensions / non-http — ignore */
  if (!url.startsWith('http')) return;

  /* 4. Navigation (page loads) — network-first, fall back to cached index.html
   *    This is what makes the app open offline after first visit. */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          /* Cache the fresh page for offline use */
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, clone);
          });
          return response;
        })
        .catch(function () {
          /* Offline — serve cached version of this URL or fall back to index.html */
          return caches.match(request)
            .then(function (cached) {
              return cached || caches.match('/index.html');
            });
        })
    );
    return;
  }

  /* 5. Product images — cache-first (images never change once uploaded) */
  if (url.match(/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i) &&
      !url.includes(self.location.origin)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          return fetch(request).then(function (response) {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(function () {
            return new Response('', { status: 408, statusText: 'Offline' });
          });
        });
      })
    );
    return;
  }

  /* 6. App shell (JS, CSS, icons, manifest, local images)
   *    Stale-while-revalidate: serve cached instantly, update in background */
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var fetchPromise = fetch(request).then(function (response) {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function () {
          /* Network failed — cached version already returned above if it existed */
          return new Response('', { status: 408, statusText: 'Offline' });
        });

        /* Return cached immediately if available, otherwise wait for network */
        return cached || fetchPromise;
      });
    })
  );
});
