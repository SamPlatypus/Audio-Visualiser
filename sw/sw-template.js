/* Auralis offline service worker (generated at build time from sw/sw-template.js). */
const VERSION = '__VERSION__';
const CACHE = `auralis-${VERSION}`;
const ASSETS = __ASSETS__;

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map((p) => new Request(scoped(p), { cache: 'reload' })));
      // First install: nothing to replace, so take over straight away.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('auralis-') && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // App shell: always answer navigations from the cache so the app opens offline.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const shell = (await cache.match(scoped('index.html'))) || (await cache.match(scoped('./')));
        if (shell) return shell;
        try {
          return await fetch(req);
        } catch {
          return new Response('Auralis is offline and has not been cached yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});
