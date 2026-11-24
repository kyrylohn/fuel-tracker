/* Сервіс-воркер: оболонка застосунку в кеші, щоб «Бак» відкривався без мережі.
   API завжди йде в мережу; останній знімок даних живе в localStorage. */
const VERSION = 'fuel-v1.15.0';
const SHELL = ['/', '/app.js', '/app.css', '/calc.js', '/i18n.js', '/boot.js', '/manifest.webmanifest', '/login', '/login.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/fonts/onest-cyrillic-400-normal.woff2', '/fonts/onest-cyrillic-500-normal.woff2',
  '/fonts/onest-cyrillic-600-normal.woff2', '/fonts/onest-latin-400-normal.woff2', '/fonts/onest-latin-600-normal.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
async function networkFirst(req, key) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(req), timeout(4000)]);
    if (res.ok && !res.redirected) cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, url.pathname.startsWith('/login') ? '/login' : '/')); return; }
  if (/^\/(fonts|icons)\//.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req));
});
