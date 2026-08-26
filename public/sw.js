/**
 * Service worker: يخلي التطبيق يفتح بدون نت.
 *
 * Cache-first for the app shell (it changes only on deploy), network-only for
 * everything under /api — a stale API response would be worse than an error,
 * and caching authenticated responses on disk is not something to do casually.
 */

const VERSION = 'hadeed-v4';
const SHELL = [
  '/',
  '/css/app.css',
  '/css/fonts.css',
  '/js/main.js',
  '/js/dom.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/store.js',
  '/js/gym.js',
  '/js/program.js',
  '/js/engine.js',
  '/js/views/home.js',
  '/js/views/cardio.js',
  '/js/views/week.js',
  '/js/views/nutri.js',
  '/js/views/account.js',
  '/js/views/onboarding.js',
  '/js/views/reset.js',
  '/manifest.webmanifest',
  '/img/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // A single missing file must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API traffic

  // Navigations: network first so a deploy is picked up, cache as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    );
    return;
  }

  // Assets: network first, cache as the offline fallback.
  //
  // Cache-first would be faster, but it also means a phone that installed the
  // app once keeps running the old JavaScript after a deploy until the cache
  // name changes — a stale bundle talking to a newer API is a bad failure to
  // debug. Freshness wins here; the cache still covers being offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || Response.error()))
  );
});
