const CACHE = 'magneto-v2';
const SHELL = ['/', '/magneto.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always go network-first for API calls so live data is fresh
  if (url.pathname.startsWith('/magneto/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Cache-first for shell assets
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
