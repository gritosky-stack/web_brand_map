/**
 * Прокси тайлов глобального хитмапа Strava — Cloudflare Worker.
 *
 * Зачем: напрямую из браузера тайлы Strava не работают.
 *   1. CloudFront не отдаёт Access-Control-Allow-Origin, а mapbox-gl тянет
 *      растр через fetch/crossOrigin="anonymous" — тайлы молча не рисуются.
 *   2. Без подписи CloudFront зум глубже 12 отдаёт 403.
 * Воркер решает оба: добавляет CORS и подставляет подпись из секретов.
 * (В нативном iOS-приложении прокси не нужен — там CORS нет, а подпись
 *  подставляется в URL прямо в StravaHeatmap.swift.)
 *
 * Развернуть:
 *   npm i -g wrangler && wrangler login
 *   wrangler deploy tools/strava-tile-proxy.js --name strava-tiles --compatibility-date 2026-01-01
 *
 * Подпись (нужна только для зума > 12): открыть strava.com/maps/global-heatmap
 * в залогиненном браузере → DevTools → Application → Cookies → strava.com,
 * скопировать три значения CloudFront-* и положить в секреты:
 *   wrangler secret put STRAVA_KEY_PAIR_ID   # CloudFront-Key-Pair-Id
 *   wrangler secret put STRAVA_POLICY        # CloudFront-Policy
 *   wrangler secret put STRAVA_SIGNATURE     # CloudFront-Signature
 * Подпись протухает (недели) — тогда просто обновить секреты.
 *
 * Адрес воркера прописать в STRAVA_TILE_PROXY в www/script.js.
 * ALLOWED_ORIGINS ниже — чтобы воркер не стал открытым зеркалом Strava.
 */

const ALLOWED_ORIGINS = [
  'https://totskii.com',
  'http://localhost:8899',
  'capacitor://localhost',
];

// /{shard}/{sport}/{color}/{z}/{x}/{y}.png
const TILE_RE = /^\/([abc])\/(all|ride|run|water|winter)\/(\w+)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const m = TILE_RE.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404, headers: cors });
    const [, shard, sport, color, z, x, y] = m;

    // Свои тайлы кэшируем на границе — Strava дёргаем максимум раз на тайл.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    }

    const signed = env.STRAVA_KEY_PAIR_ID && env.STRAVA_POLICY && env.STRAVA_SIGNATURE;
    const path = signed ? 'tiles-auth' : 'tiles';
    const upstream = new URL(
      `https://heatmap-external-${shard}.strava.com/${path}/${sport}/${color}/${z}/${x}/${y}.png`
    );
    upstream.searchParams.set('px', '256');

    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; totskii-wild-tiles)' };
    if (signed) {
      headers['Cookie'] = [
        `CloudFront-Key-Pair-Id=${env.STRAVA_KEY_PAIR_ID}`,
        `CloudFront-Policy=${env.STRAVA_POLICY}`,
        `CloudFront-Signature=${env.STRAVA_SIGNATURE}`,
      ].join('; ');
    }

    const res = await fetch(upstream.toString(), { headers });
    if (!res.ok) {
      // 403 на z>12 = подпись не задана или протухла.
      return new Response(`Strava ${res.status}`, { status: res.status, headers: cors });
    }

    const out = new Response(res.body, {
      headers: {
        ...cors,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=604800',
      },
    });
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  },
};
