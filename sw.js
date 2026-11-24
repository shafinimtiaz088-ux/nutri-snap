// sw.js — service worker: makes NutriSnap installable and work offline.
// Strategy: the app's own files are pre-cached (cache-first, so it opens instantly).
// Requests to Open Food Facts are NOT cached here; scanned products are kept
// encrypted in IndexedDB instead, so nothing personal sits in an unencrypted cache.

const CACHE = 'nutrisnap-v1.0.1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './app.js',
  './logic.js',
  './crypto.js',
  './storage.js',
  './api.js',
  './scanner.js',
  './zxing.min.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API calls go straight to the network

  // Page navigations: serve the cached app so it opens offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req))
  );
});
