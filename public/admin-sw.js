// The admin panel's service worker: it exists only so Chrome / Edge offer «Встановити» for the panel (admin.webmanifest).
// Registered with the scope ./admin.html, so it never sees the game's pages. Network first for the panel page and its
// files; a copy of the page is kept only to show something when the network is gone. Nothing under /api/ (the
// admin calls are POST /api/admin/…) is ever stored or answered from a cache.
const CACHE = 'avtodrop-admin-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('avtodrop-admin-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only plain GETs of this site; the API, other sites and everything else go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin-api')) return;
  const page = req.mode === 'navigate';
  e.respondWith(fetch(req).then((res) => {
    if (page && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/admin.html', copy)).catch(() => {});
    }
    return res;
  }).catch(() => (page ? caches.match('/admin.html').then((r) => r || Response.error()) : Response.error())));
});
