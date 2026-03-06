/* sw.js - QuickShop Service Worker v3.2 (Production Build) */

const CACHE_NAME = 'qs-cache-v5';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/styless.css',
  '/appss.js',
  '/indexeddb_sync.js',
  '/supabase-config.js',
  '/manifest.json',
  // Third-party Hardening: Cache CDN assets so the app works fully offline
  'https://unpkg.com/@zxing/library@latest/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'pwa-192.png',
  'pwa-512.png'
];

// Install: Populate cache
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

// Activate: Clean up old Firebase or legacy QuickShop caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy: Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  // 1. Skip non-GET and Supabase API calls (Auth must be live)
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Dynamic caching for product images
        if (networkResponse && networkResponse.status === 200 && event.request.url.match(/\.(jpg|jpeg|png|gif|webp)/)) {
          const clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clonedResponse));
        }
        return networkResponse;
      }).catch(() => {
        // Return nothing if network fails and not in cache
      });

      return cachedResponse || fetchPromise;
    })
  );
});
