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
var CACHE_NAME    = 'qs-v2.1.10';

var IMAGE_CACHE   = 'qs-images-v4.0';
var MARKET_CACHE  = 'qs-market-v2.1';
/* ── Install: validate and refresh the complete app shell before activation ──
 * Existing clients may still be running an older qs-init.js that cannot take
 * part in a page-to-worker update handshake. Therefore the installing worker
 * owns the first-rollout safety gate: it fetches both navigable app documents,
 * discovers their static same-origin scripts/styles, adds the admin/storefront
 * scripts loaded dynamically by qs-init.js, and validates every response.
 *
 * No existing cache entry is changed until ALL required network fetches succeed.
 * If offline or any required asset is unavailable, install rejects and the old
 * active worker plus its offline cache remain in service. No page is reloaded.
 */
var UPDATE_DYNAMIC_ASSETS = [
  'catalog.js',
  'indexeddb_sync.js',
  'share-catalog.js',
  'appss.js',
  'canonical.js',
  'inventory.js'
];

function addSameOriginAsset(urls, rawUrl, documentUrl) {
  try {
    var parsed = new URL(rawUrl, documentUrl);
    if (parsed.origin !== self.location.origin ||
        !/^https?:$/.test(parsed.protocol)) return;
    parsed.hash = '';
    urls.add(parsed.href);
  } catch (_) {}
}

function discoverDocumentAssets(html, documentUrl, urls) {
  var scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  scriptTags.forEach(function (tag) {
    var match = tag.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (match) addSameOriginAsset(urls, match[1] || match[2] || match[3], documentUrl);
  });

  var linkTags = html.match(/<link\b[^>]*>/gi) || [];
  linkTags.forEach(function (tag) {
    var rel = tag.match(/\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    var href = tag.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    var relValue = rel && (rel[1] || rel[2] || rel[3]) || '';
    if (/(^|\s)stylesheet(\s|$)/i.test(relValue) && href) {
      addSameOriginAsset(urls, href[1] || href[2] || href[3], documentUrl);
    }
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var origin = self.location.origin;
    var documentUrls = [new URL('/', origin).href, new URL('/search.html', origin).href];
    var documents = [];

    for (var i = 0; i < documentUrls.length; i++) {
      var documentRequest = new Request(documentUrls[i], {
        method: 'GET',
        cache: 'reload',
        credentials: 'same-origin'
      });
      var documentResponse = await fetch(documentRequest);
      if (!documentResponse || !documentResponse.ok || documentResponse.type === 'opaque') {
        throw new Error('Required app document could not be refreshed: ' + documentUrls[i]);
      }
      documents.push({
        url: documentUrls[i],
        response: documentResponse,
        html: await documentResponse.clone().text()
      });
    }

    var assetUrls = new Set();
    documents.forEach(function (documentEntry) {
      discoverDocumentAssets(documentEntry.html, documentEntry.url, assetUrls);
    });
    UPDATE_DYNAMIC_ASSETS.forEach(function (asset) {
      addSameOriginAsset(assetUrls, asset, origin + '/');
    });

    var refreshedAssets = [];
    for (var assetUrl of assetUrls) {
      var assetRequest = new Request(assetUrl, {
        method: 'GET',
        cache: 'reload',
        credentials: 'same-origin'
      });
      var assetResponse = await fetch(assetRequest);
      if (!assetResponse || !assetResponse.ok || assetResponse.type === 'opaque') {
        throw new Error('Required app asset could not be refreshed: ' + assetUrl);
      }
      refreshedAssets.push({ url: assetUrl, response: assetResponse });
    }

    // Network validation is complete. Only now touch the existing app-shell
    // cache; images and marketplace caches are deliberately never opened here.
    var cache = await caches.open(CACHE_NAME);
    for (var refreshed of refreshedAssets) {
      await cache.put(new Request(refreshed.url), refreshed.response.clone());
    }
    for (var documentEntry of documents) {
      await cache.put(new Request(documentEntry.url), documentEntry.response.clone());
    }
    // Keep the canonical offline fallback current as well as the root route.
    var indexDocument = documents[0];
    await cache.put(new Request(new URL('/index.html', origin).href), indexDocument.response.clone());

    await self.skipWaiting();
  })());
});

/* ── Activate ────────────────────────────────────────────────────────────────
 * Delete every cache that doesn't match our current names.
 * Claim all clients so this SW controls existing tabs immediately. */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME && key !== IMAGE_CACHE && key !== MARKET_CACHE;
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
   *    EXCEPTION 1: Supabase Storage image URLs (/storage/v1/object/public/)
   *    are permanent CDN URLs that never change after upload. These must be
   *    allowed through to the cache-first image handler below (rule 5).
   *    Without this exception, all product photos go network-only and the
   *    catalog cannot display images offline.
   *
   *    EXCEPTION 2: Public marketplace REST views are network-first.
   *    While online, buyers must see current sellable inventory. The last
   *    successful marketplace response is retained only as an offline fallback.
   *    This keeps the public market resilient without allowing a connected
   *    browser cache to override authoritative product state. */
  var isSupabase = url.includes('supabase.co') || url.includes('supabase.in');
  var isSupabaseStorage = isSupabase && url.includes('/storage/v1/object/');

  var MARKET_TABLES = [
    '/rest/v1/qs_market_products_v2',
    '/rest/v1/qs_market_offers_v2',
    '/rest/v1/qs_active_stores_v2',
    '/rest/v1/qs_market_products_by_category_v2',
    '/rest/v1/qs_market_stores_by_category_v2'
  ];
  var isMarketplaceTable = isSupabase &&
    !isSupabaseStorage &&
    request.method === 'GET' &&
    MARKET_TABLES.some(function (t) { return url.includes(t); });

  if (isMarketplaceTable) {
    /* Live marketplace reads are network-first while online.
     * Cached JSON is fallback only when the network genuinely fails.
     * This prevents a connected buyer from being served yesterday's stock,
     * while still allowing the last-known marketplace to render offline. */
    event.respondWith(
      caches.open(MARKET_CACHE).then(function (cache) {
        return fetch(request).then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function () {
          return cache.match(request).then(function (cached) {
            if (cached) return cached;
            return new Response(JSON.stringify({ message: 'Offline and no cached marketplace data' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        });
      })
    );
    return;
  }

  if (isSupabase && !isSupabaseStorage) return; // all other Supabase: network-only

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
   *    Stale-while-revalidate: serve cached instantly, update in background.
   *
   *    CRITICAL: no synthetic 408 on network failure. A 408 from the SW is
   *    treated as a real server response — scripts get silently dropped, the
   *    app goes blank, and nothing retries. Without a catch block, a failed
   *    fetch rejects the Promise naturally (ERR_FAILED), which the browser
   *    handles correctly and does not cache. */
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var fetchPromise = fetch(request).then(function (response) {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        });
        /* Cached hit: return instantly, revalidation runs in background.
         * Cache miss: wait for network. Network failure → Promise rejects →
         * browser handles natively. No synthetic error injected. */
        return cached || fetchPromise;
      });
    })
  );
});
