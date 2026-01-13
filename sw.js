/* sw.js - Service Worker for Caching App Shell */

/* [FIX]: Bumped version to v2. 
   This change alone forces the browser to reinstall the worker 
   and trigger the cleanup of the old 'v1' cache. 
*/
const CACHE_NAME = 'quickshop-cache-v2';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/report.js',
  '/indexeddb_sync.js',
  '/firebase-config.js',
  '/manifest.json',
  /* [FIX]: Added these external libraries to the cache. 
     Previously, if the internet cut out, the scanner and charts 
     would stop working because they weren't saved offline. 
  */
  'https://unpkg.com/@zxing/library@latest/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js',
  'pwa-192.png',
  'pwa-512.png'
];

// Install event: cache all the app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
      .then(() => {
        // Force the waiting service worker to become the active service worker immediately
        return self.skipWaiting();
      })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // [Logic]: If the cache name is NOT 'quickshop-cache-v2', DELETE IT.
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      // Take control of all open clients immediately so the user sees updates instantly
      return self.clients.claim();
    })
  );
});

// Fetch event: serve from cache first (Cache-First strategy)
self.addEventListener('fetch', (event) => {
  // We only want to cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Don't cache Firebase requests (Let Firebase SDK handle its own offline logic)
  if (event.request.url.includes('firebase') || event.request.url.includes('googleapis') || event.request.url.includes('firestore')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        
        return fetch(event.request)
          .then((networkResponse) => {
            // [FIX]: Dynamic Image Caching
            // If the user loads a product image while online, save it to cache
            // so it appears next time they are offline.
            if (networkResponse && networkResponse.status === 200 && event.request.url.match(/\.(jpg|jpeg|png|gif|webp)/)) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
            }
            return networkResponse;
          })
          .catch(() => {
            console.warn('[SW] Fetch failed for:', event.request.url);
          });
      })
  );
});
