// TourFlow Service Worker — enables PWA installation
const CACHE = 'tourflow-v3';
const PRECACHE = ['/icon-192.png', '/icon-512.png', '/favicon.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Network-first for HTML — always get fresh app code
  // Cache-first only for icons/images
  var url = e.request.url;
  var isHtml = url.endsWith('.html') || url.endsWith('/');
  if(isHtml) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request);
      })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          return caches.open(CACHE).then(function(cache) {
            cache.put(e.request, response.clone());
            return response;
          });
        });
      })
    );
  }
});
