/* Offline shell for the home-screen web app (iPhone, and Android browsers).

   NETWORK FIRST, cache as the fallback. A cache-first worker would keep
   serving an old build after every deploy until some later visit — exactly
   wrong while the family is testing and fixes ship daily. So: when online,
   every file comes fresh and the copy in the cache is refreshed; when
   offline, the last good copy opens the app. Only this app's own files are
   cached — never market data or AI replies, which go to other hosts.

   Not registered inside the Android app, which loads its files from the APK. */
const CACHE = 'corpus-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    e.respondWith((async () => {
        try {
            const fresh = await fetch(req);
            if (fresh.ok) {
                const copy = fresh.clone();
                caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
            }
            return fresh;
        } catch (_) {
            const cached = await caches.match(req, { ignoreSearch: true });
            if (cached) return cached;
            if (req.mode === 'navigate') {
                const shell = await caches.match('./') || await caches.match('./index.html');
                if (shell) return shell;
            }
            return Response.error();
        }
    })());
});
