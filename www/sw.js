/* Service Worker — TOTSKII Wild
 * Стратегии:
 *   - App shell (HTML/CSS/JS/libs): Cache-first, обновление в фоне
 *   - GPX треки: Cache-first (меняются редко)
 *   - Фото: Cache-first с лимитом 120 записей (Network-first слишком медленно в горах)
 *   - Mapbox tiles/API: Network-first, fallback на кэш
 */

const SHELL_VERSION = 'v2';
const SHELL_CACHE   = `shell-${SHELL_VERSION}`;
const GPX_CACHE     = 'gpx-v1';
const PHOTO_CACHE   = 'photos-v1';
const PHOTO_LIMIT   = 250;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/assistant.js',
  '/route_matcher.js',
  '/pss_layer.js',
  '/routes_geom.json',
  '/routes_index.json',
  '/pss_routes_web.geojson',
  '/libs/mapbox-gl.js',
  '/libs/mapbox-gl.css',
  '/libs/chart.js',
  '/libs/tailwind.js',
];

// ── Install: кэшируем app shell ──────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
});

// ── Activate: удаляем старые кэши ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== GPX_CACHE && k !== PHOTO_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Только GET
  if (request.method !== 'GET') return;

  // Mapbox tiles / API — network-first, fallback кэш
  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.cn')) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // GPX треки
  if (url.pathname.endsWith('.gpx')) {
    event.respondWith(cacheFirst(request, GPX_CACHE));
    return;
  }

  // Фото (jpg/jpeg/png/webp)
  if (/\.(jpe?g|png|webp)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstWithLimit(request, PHOTO_CACHE, PHOTO_LIMIT));
    return;
  }

  // App shell и всё остальное с того же origin.
  // Отдаём из кэша сразу, а в фоне подтягиваем свежую версию — иначе правки
  // в script.js/index.html не доезжают до тех, кто уже открывал сайт.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
});

// ── Стратегии ────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request).then(response => {
    if (response.ok) {
      caches.open(cacheName).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => cached);
  return cached || network;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function cacheFirstWithLimit(request, cacheName, limit) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!response.ok) return response;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length >= limit) {
    // удаляем самую старую запись
    await cache.delete(keys[0]);
  }
  cache.put(request, response.clone());
  return response;
}
