// Service worker: makes the app and its public land data work with no signal.
// The build step fills in the file list and version below (see vite.config.js).
const VERSION = '__VERSION__';
const PRECACHE = self.__PRECACHE__ || [];
const APP_CACHE = `app-${VERSION}`;
// Offline map tiles live in caches named "tiles-<area id>" (added in the offline phase).
const TILE_HOSTS = ['server.arcgisonline.com', 'services.arcgisonline.com', 'basemap.nationalmap.gov'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('app-') && key !== APP_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// The page asks us to activate a waiting update when the user taps "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: use a downloaded copy if we have one, otherwise the network.
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req.url).then((hit) => hit || fetch(req)),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App page: answer from cache instantly (works offline), so the app always opens.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => (await cache.match('./')) || fetch(req)),
    );
    return;
  }

  // App files and data: cache first, then network.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
