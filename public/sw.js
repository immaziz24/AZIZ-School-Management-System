// Service worker: keeps the page shell so the app opens without a connection.
// School data always comes live from Firebase; nothing private is stored here.
const CACHE = 'aziz-shell-v3';
const SHELL = ['./', './index.html', './sign-in.css', './sign-in.mjs', './platform.mjs', './ui.mjs', './i18n.mjs', './firebase-client.mjs',
  './school.html', './school.mjs', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  // Each file is added on its own, so one missing file does not stop the rest being kept for offline use.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))));
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

// Phone notifications (feature 150). The server sends a data message with a title, a body and a page to open.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const info = payload.data ?? payload.notification ?? payload;
  event.waitUntil(self.registration.showNotification(info.title || 'AZIZ School', {
    body: info.body || '', icon: './icon-192.png', data: { url: info.url || './' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => 'focus' in client);
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
