/* PSY6 service worker (Run 9 PWA) — CACHE-SAFE OR NOT AT ALL.
 *
 * Strategy: NETWORK-FIRST for navigations and same-origin GETs. The cache is
 * an OFFLINE FALLBACK ONLY — when the network is reachable the user always
 * gets the freshly-served bytes. This project has been burned by stale
 * serving before (stale disk caches during release verification); staleness
 * is unacceptable, so:
 *   - every successful network response refreshes the cache copy
 *   - cache is consulted ONLY when the network fails (offline)
 *   - activate deletes every cache whose name is not the current version
 *   - skipWaiting + clients.claim: the new SW takes over immediately
 *
 * RELEASE CHECKLIST (documented in ARCHITECTURE.md §13): bump CACHE_VERSION
 * on EVERY release. tools/verify.mjs asserts the version matches the latest
 * CHANGELOG entry — a release that forgets the bump fails verification.
 */
const CACHE_VERSION = 'psy6-v0.27.0';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* cross-origin: untouched */
  /* network-first: fresh bytes win; cache only rescues offline */
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => { /* quota — cache is best-effort */ });
        }
        return resp;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('offline', { status: 503, statusText: 'offline' });
        })
      )
  );
});
