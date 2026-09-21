/* Service Worker — TOTSKII Wild
 * Стратегии:
 *   - App shell (HTML/CSS/JS/libs): Network-first мимо HTTP-кэша, кэш —
 *     только когда сети нет (с таймаутом, чтобы в горах не ждать вечно)
 *   - GPX треки: Cache-first (меняются редко)
 *   - Фото: Cache-first с лимитом записей (Network-first слишком медленно в горах)
 *   - Mapbox: стиль, спрайты и шрифты — Network-first; **тайлы не трогаем**
 */

const SHELL_VERSION = 'v25';
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
  '/supa.js',
  '/account.js',
  '/route_status.js',
  '/route_builder.js',
  '/mvt.js',
  '/map_points.js',
  '/premium.js',
  '/extra_layers.js',
  '/map_slots.js',
  '/point_insight.js',
  '/my_location.js',
  '/weather.js',
  '/route_matcher.js',
  '/pss_layer.js',
  '/grade_color.js',
  '/profile_chart.js',
  '/time_planner.js',
  '/cinematic.js',
  '/route_marks.js',
  '/map_tiers.js',
  '/photo_viewer.js',
  '/route_profile_ui.js',
  '/routes_geom.json',
  '/routes_index.json',
  '/pss_routes_web.geojson',
  '/libs/mapbox-gl.js',
  '/libs/mapbox-gl.css',
  '/libs/tailwind.js',
  '/libs/supabase.js',
];

// ── Install: кэшируем app shell ──────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    // cache: 'reload' — мимо HTTP-кэша браузера: иначе в кэш новой версии
  // ложились старые файлы, которые браузер ещё держал у себя
  caches.open(SHELL_CACHE).then(cache =>
    cache.addAll(SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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
    )
    // Вычищаем из кэша фото то, что туда натаскали тайлы хитмапа
    .then(() => caches.open(PHOTO_CACHE))
    .then(cache => cache.keys().then(keys => Promise.all(keys
      .filter(r => new URL(r.url).origin !== self.location.origin)
      .map(r => cache.delete(r)))))
    .catch(() => {})
    .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Только GET
  if (request.method !== 'GET') return;

  // Mapbox. ⚠️ Тайлы идут мимо service worker'а, прямо браузеру (у них свои
  // заголовки кэширования). Раньше через него шёл каждый тайл: ждали сеть,
  // потом писали в Cache Storage — при облёте это сотни тайлов в секунду
  // через одно узкое место с записью на диск, и карта отставала от камеры
  // тёмными дырами и мыльными заглушками (фидбэк 2026-09-19). Сохраняем
  // только маленькое и нужное для запуска без сети: стиль, спрайты, шрифты.
  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.cn')) {
    if (/\/(styles|fonts)\//.test(url.pathname)) event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // GPX треки
  if (url.pathname.endsWith('.gpx')) {
    event.respondWith(cacheFirst(request, GPX_CACHE));
    return;
  }

  // Чужие хосты (хитмап OSM, аватары Google, BRouter, Supabase) — мимо SW.
  // ⚠️ Тайлы хитмапа — это `.png`, и правило «Фото» ниже гнало каждый из
  // них через Cache Storage с лимитом: поиск, `cache.keys()`, удаление
  // старой записи — на каждый тайл. При прокрутке их сотни, очередь не
  // успевала, хитмап оставался мыльным (тайлы соседнего зума), а после
  // выключения и включения на телефоне не приходил вовсе (фидбэк
  // 2026-09-19). Заодно он вытеснял из кэша настоящие фото маршрутов.
  if (url.origin !== self.location.origin) return;

  // Фото (jpg/jpeg/png/webp)
  if (/\.(jpe?g|png|webp)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstWithLimit(request, PHOTO_CACHE, PHOTO_LIMIT));
    return;
  }

  // App shell и всё остальное с того же origin — сначала сеть.
  // ⚠️ Было «из кэша сразу, свежее в фоне»: новая версия сайта доезжала только
  // со второй-третьей загрузки, а фоновое обновление вдобавок брало файлы из
  // HTTP-кэша браузера — на телефоне подолгу работал старый код, и уже
  // исправленные баги «не исправлялись». Кэш — только без сети.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstShell(request, SHELL_CACHE));
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

// Сеть (мимо HTTP-кэша, но с условным запросом — неизменённый файл придёт
// коротким 304), а если за 4 с не ответила или её нет — кэш
async function networkFirstShell(request, cacheName) {
  const network = fetch(request, { cache: 'no-cache' }).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(cacheName).then(cache => cache.put(request, copy));
    }
    return response;
  });
  network.catch(() => {});   // проигравший гонку запрос не должен ронять SW
  const timeout = new Promise(resolve => setTimeout(resolve, 4000));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch (e) { /* сети нет — ниже кэш */ }
  const cached = await caches.match(request);
  if (cached) return cached;
  return network;
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
