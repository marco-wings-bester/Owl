// Caches the app so it opens offline. Bump CACHE, ?v= (index.html/cloud.js) and APP_VERSION (index.html) together on every release.
const CACHE = 'habits-v32';
const FILES = ['./', 'index.html', 'cloud.js?v=32', 'firebase-config.js?v=32', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Network first so updates show up, falling back to the cache when offline.
// The app's own files skip the browser's HTTP cache (GitHub Pages caches for 10 minutes),
// so every file comes from the same release instead of a mix of old and new.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const ownFile = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    (ownFile ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request))
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
