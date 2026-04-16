// ============================================================
//  DRIED DEPOT — Service Worker
//  Enables PWA install on Android & iOS + offline support
// ============================================================

const CACHE = 'dried-depot-v24';
const FILES = ['./style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim()).then(() => {
            // Tell all open tabs an update just happened
            return self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
            });
        })
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;

    // Always fetch index.html fresh (no cache) for instant updates
    if (e.request.url.includes('index.html') || e.request.url.endsWith('/')) {
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
        return;
    }

    // Cache-first for other resources (CSS/JS/images)
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
    );
});
