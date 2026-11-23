// Offline support: the app shell is cached; API calls always go to the network.
const CACHE = 'life-v7';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/db.js', './js/sync.js', './js/crypto.js', './js/schemas.js', './js/journal.js', './js/gmail.js', './js/gcal.js', './js/google.js', './js/tree.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first so updates arrive quickly; fall back to cache offline
  e.respondWith(
    // no-cache: always revalidate with GitHub Pages instead of trusting the browser's 10-minute cache
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
