// Service worker: keeps the page shell so the app opens without a connection.
// School data always comes live from Firebase; nothing private is stored here.
const CACHE = 'aziz-shell-v1';
const SHELL = ['./', './index.html', './sign-in.css', './sign-in.mjs', './firebase-client.mjs', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Network first, so a new release is picked up straight away; the cached copy is used only offline.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))));
});
