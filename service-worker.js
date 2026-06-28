// TourFlow Service Worker
const CACHE_NAME = 'tourflow-v1';
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
  
  // Never cache or intercept API calls, supabase, or non-GET requests
  if (
    url.includes('supabase.co') ||
    url.includes('netlify') ||
    url.includes('stripe') ||
    event.request.method !== 'GET'
  ) {
    return; // Let browser handle it normally
  }

  // Let admin.html and t.html pass through normally
  if (url.includes('/admin.html') || url.includes('/t.html')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For navigation requests, serve index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then(r => r || fetch(event.request))
    );
    return;
  }
  // Cache-first for static assets
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
