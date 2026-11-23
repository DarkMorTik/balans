// Service worker: офлайн-кэш оболочки приложения. Никаких внешних запросов.
const VERSION = 'balans-v10';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/db.js',
  'js/crypto.js',
  'js/vault.js',
  'js/store.js',
  'js/analytics.js',
  'js/charts.js',
  'js/market.js',
  'js/guilloche.js',
  'js/planner.js',
  'js/nlp.js',
  'js/csv.js',
  'js/ics.js',
  'js/sync.js',
  'js/theme.js',
  'js/report.js',
  'js/sheet.js',
  'js/views/lock.js',
  'js/views/home.js',
  'js/views/editor.js',
  'js/views/stats.js',
  'js/views/settings.js',
  'js/views/portfolio.js',
  'js/views/calendar.js',
  'js/views/plans.js',
  'js/views/planner-sheets.js',
  'js/views/money-sheets.js',
  'js/views/budget.js',
  'js/views/import.js',
  'js/views/focus.js',
  'js/views/invest.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала сеть (чтобы получать обновления), при отсутствии сети — кэш.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(new Request(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
