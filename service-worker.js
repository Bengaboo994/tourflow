// TourFlow Service Worker
// ⬆ Bump this number every time you deploy a change
const VERSION = 4;
const CACHE_NAME = 'tourflow-v' + VERSION;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/t.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
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
  const url = event.request.url;

  // Never intercept API calls or non-GET requests
  if (
    url.includes('supabase.co') ||
    url.includes('netlify') ||
    url.includes('stripe') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Let admin.html and t.html pass through directly (no cache)
  if (url.includes('/admin.html') || url.includes('/t.html')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For navigation requests, always try network first, fall back to cache
  // This ensures a fresh index.html is served when online
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Cache-first for static assets (fonts, icons etc)
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
