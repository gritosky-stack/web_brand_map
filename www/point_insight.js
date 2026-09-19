/**
 * Карточка точки: долгое нажатие на карту (на компьютере — правый клик) или
 * координаты в строке ассистента. Порт `MapboxMapView+PointInsight.swift`,
 * `SearchedPoint.swift`, `SearchedPointPanel.swift` и `CoordinateSearch.swift`.
 *
 * Карточка отвечает на то, что человек спросит про голую точку следующим:
 * высоко ли это, крутой ли склон и куда он смотрит, далеко ли до людей,
 * воды, крыши и ближайшего маршрута.
 *
 * Высота и крутизна — с тайла рельефа Mapbox z14 (`terrain-rgb`, те же
 * данные, что под рельефом карты), а не `queryTerrainElevation`: тот отвечает
 * тем DEM, что загружен **для текущего зума**, и на обзоре страны это клетка
 * в пару километров — крутизна на плече 60 м вышла бы шумом. Не приехал
 * тайл — откатываемся на рельеф карты.
 *
 * `CoordinateSearch` не зависит от браузера — его можно гонять в Node.
 */
(function (root) {
    'use strict';

    // ── Разбор координат (CoordinateSearch.swift) ───────────────────────────
    //
    // Координаты приходят откуда угодно — из чужого трека, из чата, из Google
    // Maps, с таблички на перевале. Строка раскладывается на числа и буквы
    // полушарий, а уже из них собирается пара широта/долгота:
    //   44.2107, 20.9029 · 44,2107 20,9029 · 44.2107N 20.9029E · N44.21 E20.90
    //   44°12'38.5"N 20°54'10.4"E · 44°12.642' 20°54.174' · 44 12 38.5 20 54 10.4
    //   geo:44.2107,20.9029 · ссылки Google Maps (…/@44.21,20.90,15z, !3d…!4d…, ?q=)

    function describe(lat, lon) {
        return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}, ` +
               `${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
    }

    /** Градусы-минуты-секунды — так координаты пишут на табличках */
    function describeDMS(lat, lon) {
        const part = (v, pos, neg) => {
            const a = Math.abs(v);
            let d = Math.floor(a), mFull = (a - d) * 60, m = Math.floor(mFull);
            let s = Math.round((mFull - m) * 600) / 10;
            if (s >= 60) { s = 0; m += 1; }
            if (m >= 60) { m = 0; d += 1; }
            return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v >= 0 ? pos : neg}`;
        };
        return part(lat, 'N', 'S') + ' ' + part(lon, 'E', 'W');
    }

    function normalize(raw) {
        let text = String(raw || '').trim();
        try { text = decodeURIComponent(text); } catch (e) { /* не ссылка */ }
        text = text.toUpperCase();

        // Ссылки: из них берём кусок с координатами. `!3d…!4d…` — сама точка
        // места, а `@…` — лишь центр экрана, поэтому она первая
        let m;
        if ((m = text.match(/!3D(-?\d+\.\d+)!4D(-?\d+\.\d+)/))) text = `${m[1]} ${m[2]}`;
        else if ((m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) text = `${m[1]} ${m[2]}`;
        else if ((m = text.match(/(?:GEO:|[?&]Q=|[?&]LL=|QUERY=|DESTINATION=)(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)))
            text = `${m[1]} ${m[2]}`;

        // ⚠️ Запятая по умолчанию — разделитель. Десятичная она только в
        // строке вида `44,2107 20,9029`: две запятые, обе внутри чисел
        if (/^[+-]?\d+,\d+\s+[+-]?\d+,\d+$/.test(text)) text = text.replace(/,/g, '.');

        text = text.replace(/[°º'′"″’”,;|/:=]/g, ' ');
        // Слова (GEO, HTTPS, GOOGLE…) выкидываем целиком: буквы E и N в них
        // сошли бы за полушария
        text = text.replace(/[A-ZА-ЯЁ]{2,}/g, ' ');
        return text.trim();
    }

    function tokenize(text) {
        const groups = [];
        let current = { numbers: [], axis: null, negative: false, axisFromPrefix: false };
        let number = '', pendingNegative = false, pendingAxis = null;

        const flushNumber = () => {
            const v = number === '' ? NaN : Number(number);
            if (number !== '' && isFinite(v)) {
                if (!current.numbers.length) {
                    current.negative = pendingNegative;
                    if (pendingAxis) { current.axis = pendingAxis; current.axisFromPrefix = true; }
                }
                current.numbers.push(v);
                pendingNegative = false;
                pendingAxis = null;
            }
            number = '';
        };
        const flushGroup = () => {
            flushNumber();
            if (current.numbers.length) groups.push(current);
            current = { numbers: [], axis: null, negative: false, axisFromPrefix: false };
        };

        for (const ch of text) {
            if ((ch >= '0' && ch <= '9') || ch === '.') {
                number += ch;
            } else if (ch === '-' || ch === '+') {
                // Знак после уже набранных чисел — начало второй половины:
                // «-44.21 -20.90». Без этого минус у долготы терялся
                flushNumber();
                if (current.numbers.length) flushGroup();
                pendingNegative = ch === '-';
            } else if ('NSEW'.includes(ch)) {
                const axis = (ch === 'N' || ch === 'S') ? 'lat' : 'lon';
                const negative = ch === 'S' || ch === 'W';
                if (!current.numbers.length && number === '') {
                    pendingAxis = axis;             // буква до чисел открывает половину
                    pendingNegative = negative;
                } else if (current.axisFromPrefix) {
                    flushGroup();                   // «E20.9 N44.2»: открывает следующую
                    pendingAxis = axis;
                    pendingNegative = negative;
                } else {
                    flushNumber();                  // буква после чисел закрывает половину
                    current.axis = axis;
                    if (negative) current.negative = true;
                    flushGroup();
                }
            } else {
                flushNumber();
            }
        }
        flushGroup();
        return groups;
    }

    /** Две половины: собраны буквами полушарий, либо числа делятся пополам */
    function split(groups) {
        if (groups.length === 2) return groups;
        if (groups.length !== 1) return null;
        const n = groups[0].numbers;
        if (![2, 4, 6].includes(n.length)) return null;
        const half = n.length / 2;
        return [
            { numbers: n.slice(0, half), axis: groups[0].axis, negative: groups[0].negative },
            { numbers: n.slice(half), axis: null, negative: false }
        ];
    }

    /** 1 число — градусы, 2 — градусы и минуты, 3 — ещё и секунды */
    function value(group) {
        const n = group.numbers;
        if (n.length < 1 || n.length > 3) return null;
        if (n.length >= 2 && n[1] >= 60) return null;
        if (n.length === 3 && n[2] >= 60) return null;
        let deg = Math.abs(n[0]);
        if (n.length >= 2) deg += n[1] / 60;
        if (n.length === 3) deg += n[2] / 3600;
        return (group.negative || n[0] < 0) ? -deg : deg;
    }

    function parse(raw) {
        const text = normalize(raw);
        if (!text) return null;
        const halves = split(tokenize(text));
        if (!halves) return null;
        let lat = value(halves[0]), lon = value(halves[1]);
        if (lat == null || lon == null) return null;

        const a = halves[0].axis, b = halves[1].axis;
        if (a && b && a !== b) {
            if (a === 'lon') [lat, lon] = [lon, lat];
        } else if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
            [lat, lon] = [lon, lat];                // половины переставлены местами
        }
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        return { lat, lon, interpretation: describe(lat, lon) };
    }

    const CoordinateSearch = { parse, describe, describeDMS };
    root.CoordinateSearch = CoordinateSearch;
    if (typeof document === 'undefined') {
        if (typeof module !== 'undefined') module.exports = CoordinateSearch;
        return;
    }

    // ── Рельеф ──────────────────────────────────────────────────────────────

    const DEM_Z = 14;               // ~7 м на пиксель у нас на широте
    const SLOPE_ARM = 60;           // м: два шага сетки DEM 30 м — меньше, и меряем шум
    const demTiles = new Map();

    function demTile(x, y) {
        const key = `${x}/${y}`;
        if (demTiles.has(key)) return demTiles.get(key);
        const p = new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = c.height = 256;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0);
                    const px = ctx.getImageData(0, 0, 256, 256).data;
                    const ele = new Float32Array(256 * 256);
                    for (let i = 0; i < ele.length; i++) {
                        ele[i] = -10000 + (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) * 0.1;
                    }
                    resolve(ele);
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${DEM_Z}/${x}/${y}.pngraw?access_token=${mapboxgl.accessToken}`;
        });
        demTiles.set(key, p);
        if (demTiles.size > 24) demTiles.delete(demTiles.keys().next().value);
        p.then(v => { if (!v) demTiles.delete(key); });
        return p;
    }

    /** Высота с тайла z14, билинейно. Нет тайла — рельеф карты или null */
    async function elevationAt(lon, lat) {
        const n = 2 ** DEM_Z;
        const r = lat * Math.PI / 180;
        const fx = (lon + 180) / 360 * n * 256;
        const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * 256;
        // Центры пикселей — в половинках
        const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
        const tx = fx - 0.5 - x0, ty = fy - 0.5 - y0;
        const sample = async (px, py) => {
            const tile = await demTile(Math.floor(px / 256), Math.floor(py / 256));
            if (!tile) return null;
            return tile[(py % 256) * 256 + (px % 256)];
        };
        const [a, b, c, d] = await Promise.all([sample(x0, y0), sample(x0 + 1, y0),
                                                sample(x0, y0 + 1), sample(x0 + 1, y0 + 1)]);
        if ([a, b, c, d].some(v => v == null)) {
            const m = window.map;
            const v = m && m.queryTerrainElevation ? m.queryTerrainElevation([lon, lat], { exaggerated: false }) : null;
            return v == null ? null : v;
        }
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    /**
     * Крутизна и экспозиция по четырём соседям: разница высот запад→восток и
     * юг→север даёт вектор, его длина — крутизна, направление падения —
     * экспозиция (`surfaceSlope` в приложении).
     */
    async function surfaceSlope(lon, lat) {
        const dLat = SLOPE_ARM / 111320;
        const dLon = SLOPE_ARM / Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
        const [n, s, e, w] = await Promise.all([
            elevationAt(lon, lat + dLat), elevationAt(lon, lat - dLat),
            elevationAt(lon + dLon, lat), elevationAt(lon - dLon, lat)]);
        if ([n, s, e, w].some(v => v == null)) return null;
        const se = (e - w) / (2 * SLOPE_ARM), sn = (n - s) / (2 * SLOPE_ARM);
        let aspect = Math.atan2(-se, -sn) * 180 / Math.PI;
        if (aspect < 0) aspect += 360;
        return { slope: Math.hypot(se, sn) * 100, aspect };
    }

    const COMPASS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    const compass = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

    /** Словами — теми же порогами, что у раскраски маршрута */
    function slopeLabel(p) {
        if (p.slope == null) return null;
        const v = Math.abs(p.slope);
        const word = v < 3 ? 'почти ровно' : v < 10 ? 'пологий склон' : v < 20 ? 'заметный уклон'
            : v < 35 ? 'крутой склон' : 'очень круто';
        // Экспозиция на ровном месте ничего не значит. На северном склоне
        // дольше лежит снег и держится грязь — это планирование, не украшение
        const aspect = v >= 3 && p.aspect != null ? ` · склон на ${compass(p.aspect)}` : '';
        return `${Math.round(v)}% · ${word}${aspect}`;
    }

    // ── Ближайшие объекты ───────────────────────────────────────────────────

    const meters = (a, b) => {
        const R = 6371000, toR = x => x * Math.PI / 180;
        const dLat = toR(b[1] - a[1]), dLon = toR(b[0] - a[0]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    };
    const bearing = (a, b) => {
        const toR = x => x * Math.PI / 180;
        const y = Math.sin(toR(b[0] - a[0])) * Math.cos(toR(b[1]));
        const x = Math.cos(toR(a[1])) * Math.sin(toR(b[1])) -
                  Math.sin(toR(a[1])) * Math.cos(toR(b[1])) * Math.cos(toR(b[0] - a[0]));
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    };

    const POINT_TITLES = { spring: 'Родник', well: 'Колодец', tap: 'Колонка',
                           hut: 'Дом', shelter: 'Навес', camp: 'Кемпинг' };

    // Файлы те же, что у слоёв «Вода» и «Укрытия», — браузер их уже держит,
    // если слой включали. Грузим по первому нажатию
    const datasets = {};
    function loadJSON(url) {
        if (!datasets[url]) {
            datasets[url] = fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
        }
        return datasets[url];
    }

    async function nearestPoint(url, at) {
        const gj = await loadJSON(url);
        if (!gj) return null;
        let best = null;
        for (const f of gj.features) {
            const c = f.geometry && f.geometry.coordinates;
            if (!c) continue;
            // Грубый отсев по градусам, прежде чем считать честно
            if (best && (Math.abs(c[1] - at[1]) * 111000 > best.meters)) continue;
            const d = meters(at, c);
            if (!best || d < best.meters) {
                const p = f.properties || {};
                best = { name: p.nameRu || p.name || p.nameSr || POINT_TITLES[p.kind] || 'Точка',
                         meters: d, coords: c };
            }
        }
        return best;
    }

    /**
     * Маршрут — по расстоянию до линии, а не до середины: до сорокакилометрового
     * перехода «по середине» может быть двадцать километров, когда он проходит
     * в двухстах метрах.
     */
    async function nearestRoute(at) {
        let best = null;
        const consider = (name, line, open) => {
            const step = Math.max(1, Math.floor(line.length / 400));
            for (let i = 0; i < line.length; i += step) {
                const d = meters(at, line[i]);
                if (!best || d < best.meters) best = { name, meters: d, coords: line[i], open };
            }
        };
        const cache = window.parsedRouteDataCache || {};
        for (const id of Object.keys(window.routes || {})) {
            const data = cache[id];
            if (data && data.coordinates) consider(routes[id].name, data.coordinates,
                                                   () => window.triggerRouteSelection(id));
        }
        const pss = await loadJSON('pss_routes_web.geojson');
        if (pss) for (const f of pss.features) {
            const g = f.geometry;
            if (!g) continue;
            const line = g.type === 'LineString' ? g.coordinates
                : g.type === 'MultiLineString' ? [].concat(...g.coordinates) : [];
            const slug = f.properties && f.properties.slug;
            consider((f.properties && f.properties.name) || 'Маршрут ПСС', line,
                     () => slug && window.showPSSRoute && showPSSRoute(slug));
        }
        return best;
    }

    /** Населённый пункт — из подписей тайлов (`composite/place_label`) */
    function nearestSettlement(at) {
        const m = window.map;
        if (!m || !m.getSource('composite')) return null;
        let best = null;
        let features = [];
        try { features = m.querySourceFeatures('composite', { sourceLayer: 'place_label' }); } catch (e) {}
        for (const f of features) {
            const p = f.properties || {};
            if (p.class && !String(p.class).startsWith('settlement')) continue;
            const name = p.name_ru || p.name || p.name_sr || p.name_en;
            if (!name || !f.geometry || f.geometry.type !== 'Point') continue;
            const d = meters(at, f.geometry.coordinates);
            if (!best || d < best.meters) best = { name, meters: d, coords: f.geometry.coordinates };
        }
        return best;
    }

    // ── Карточка ────────────────────────────────────────────────────────────

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const KINDS = {
        settlement: { emoji: '🏘', title: 'Населённый пункт' },
        water:      { emoji: '💧', title: 'Вода' },
        shelter:    { emoji: '⛺️', title: 'Укрытие' },
        route:      { emoji: '🥾', title: 'Маршрут' }
    };
    const ORDER = ['settlement', 'water', 'shelter', 'route'];
    const distanceLabel = m => m < 950 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;

    let point = null;       // { lat, lon, interpretation, ele, slope, aspect, nearby: {kind: thing} }
    let token = 0;

    function card() {
        let el = document.getElementById('insight-card');
        if (!el) {
            el = document.createElement('div');
            el.id = 'insight-card';
            document.body.appendChild(el);
        }
        return el;
    }

    function render() {
        const el = card();
        if (!point) { el.classList.remove('open'); return; }
        const p = point;
        const rows = ORDER.filter(k => p.nearby[k]).map(k => {
            const t = p.nearby[k];
            const dir = compass(bearing([p.lon, p.lat], t.coords));
            return `<button class="ins-row${t.open ? ' ins-link' : ''}" data-kind="${k}" ${t.open ? '' : 'tabindex="-1"'}>
                        <span class="ins-row-emoji">${KINDS[k].emoji}</span>
                        <span class="ins-row-name">${esc(t.name)}</span>
                        <span class="ins-row-dist">${distanceLabel(t.meters)} · ${dir}</span>
                    </button>`;
        }).join('');
        el.innerHTML = `
            <div class="ins-head">
                <div class="ins-coords">
                    <div class="ins-title">${esc(p.interpretation)}</div>
                    <div class="ins-sub">${describeDMS(p.lat, p.lon)}</div>
                </div>
                <button class="ins-btn" data-act="copy" aria-label="Скопировать координаты" title="Скопировать координаты">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
                </button>
                <button class="ins-btn" data-act="close" aria-label="Закрыть">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
            </div>
            <div class="ins-tiles">
                <div class="ins-tile"><div class="ins-tile-h">Высота</div>
                    <div class="ins-tile-v">${p.ele == null ? (p.terrainDone ? '—' : '…') : `${Math.round(p.ele)} м`}</div></div>
                <div class="ins-tile"><div class="ins-tile-h">Поверхность</div>
                    <div class="ins-tile-v ins-small">${slopeLabel(p) || (p.terrainDone ? '—' : '…')}</div></div>
            </div>
            ${rows ? `<div class="ins-near"><div class="ins-tile-h">Рядом</div>${rows}</div>` : ''}`;
        el.querySelector('[data-act="close"]').onclick = clear;
        el.querySelector('[data-act="copy"]').onclick = () => {
            const text = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
            const done = () => window.MyRoutes && MyRoutes.toast(`Скопировано: ${text}`);
            if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
        };
        el.querySelectorAll('.ins-link').forEach(b => {
            b.onclick = () => { const t = p.nearby[b.dataset.kind]; if (t && t.open) { clear(); t.open(); } };
        });
        el.classList.add('open');
    }

    // Булавка — кружок с перекрестьем, чтобы не путать с метками маршрута.
    // Символьный слой, а не DOM-метка: на наклонённом рельефе DOM-метка
    // висела бы в стороне от точки
    function pinImage() {
        const size = 40, r = 2, px = size * r;
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const ctx = c.getContext('2d');
        const mid = px / 2, rad = px * 0.28;
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.beginPath(); ctx.arc(mid, mid, mid - r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FF5722';
        ctx.beginPath(); ctx.arc(mid, mid, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * r;
        ctx.beginPath(); ctx.arc(mid, mid, rad + 2 * r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        const gap = rad + 3 * r, edge = 3 * r;
        ctx.moveTo(mid, edge); ctx.lineTo(mid, mid - gap);
        ctx.moveTo(mid, px - edge); ctx.lineTo(mid, mid + gap);
        ctx.moveTo(edge, mid); ctx.lineTo(mid - gap, mid);
        ctx.moveTo(px - edge, mid); ctx.lineTo(mid + gap, mid);
        ctx.stroke();
        return { image: ctx.getImageData(0, 0, px, px), pixelRatio: r };
    }

    function setPin(lngLat) {
        const m = window.map;
        if (!m) return;
        if (!m.getSource('insight-point')) {
            const pin = pinImage();
            if (!m.hasImage('insight-pin')) m.addImage('insight-pin', pin.image, { pixelRatio: pin.pixelRatio });
            m.addSource('insight-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            m.addLayer({ id: 'insight-pin', type: 'symbol', source: 'insight-point',
                         layout: { 'icon-image': 'insight-pin', 'icon-allow-overlap': true,
                                   'icon-ignore-placement': true, 'icon-pitch-alignment': 'map' } });
        }
        m.getSource('insight-point').setData({ type: 'FeatureCollection', features: lngLat
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } }] : [] });
        if (lngLat) m.moveLayer('insight-pin');
    }

    async function fillTerrain(my) {
        const ele = await elevationAt(point.lon, point.lat);
        if (my !== token) return;
        point.ele = ele;
        const s = ele == null ? null : await surfaceSlope(point.lon, point.lat);
        if (my !== token) return;
        if (s) Object.assign(point, s);
        point.terrainDone = true;
        render();
    }

    async function fillNearby(my) {
        const at = [point.lon, point.lat];
        const settle = () => {
            const s = nearestSettlement(at);
            if (s && my === token) { point.nearby.settlement = s; render(); }
        };
        settle();
        const [water, shelter, route] = await Promise.all([
            nearestPoint('water.geojson', at), nearestPoint('shelters.geojson', at), nearestRoute(at)]);
        if (my !== token) return;
        if (water) point.nearby.water = water;
        if (shelter) point.nearby.shelter = shelter;
        if (route) point.nearby.route = route;
        render();
        // После перелёта подписи посёлков вокруг приезжают не сразу
        if (!point.nearby.settlement && window.map) window.map.once('idle', () => { if (my === token) settle(); });
    }

    /** Показать точку. `fly` — для поиска: до точки ещё надо долететь */
    function show(lat, lon, interpretation, fly) {
        const my = ++token;
        if (window.MapPoints) MapPoints.hideCard();
        point = { lat, lon, interpretation: interpretation || describe(lat, lon), nearby: {},
                  ele: null, slope: null, aspect: null, terrainDone: false };
        setPin([lon, lat]);
        render();
        if (fly && window.map) {
            if (window.RouteProfile && RouteProfile.stopCinematic) RouteProfile.stopCinematic(true);
            map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14.5), pitch: 40, bearing: 0,
                        padding: { top: 0, right: 0, bottom: 0, left: 0 }, speed: 1.2, essential: true });
        }
        fillTerrain(my);
        fillNearby(my);
    }

    function clear() {
        token++;
        point = null;
        render();
        setPin(null);
    }

    /** Строка из поиска: координаты — показываем и отвечаем true */
    function searchCoordinates(text) {
        // Строка ассистента общая: «2 дня 20 км» — запрос, а не точка 2°N 20°E.
        // Координатами считаем только то, что на них похоже без сомнений
        if (/[а-яё]/i.test(text)) return false;
        // Короткую ссылку Google не раскрыть из браузера — чужой редирект без CORS
        if (/goo\.gl|g\.co\//i.test(text)) {
            if (window.MyRoutes) MyRoutes.toast('Короткую ссылку не открыть — скопируйте в Google Maps сами координаты');
            return true;
        }
        const looksLike = /\d[.,]\d|[°'′"″]|geo:|google\.|maps\./i.test(text) ||
                          (text.match(/\d+/g) || []).length >= 4;
        if (!looksLike) return false;
        const parsed = parse(text);
        if (!parsed) return false;
        const [[w, s], [e, n]] = [[17.2, 41.0], [24.4, 47.4]];     // maxBounds карты
        const inside = (lat, lon) => lon >= w && lon <= e && lat >= s && lat <= n;
        // «20.90, 44.21» — долготу поставили первой. У нас карта одной страны,
        // так что переставленная пара, попадающая в Сербию, понятнее ошибки
        if (!inside(parsed.lat, parsed.lon) && inside(parsed.lon, parsed.lat)) {
            [parsed.lat, parsed.lon] = [parsed.lon, parsed.lat];
            parsed.interpretation = describe(parsed.lat, parsed.lon);
        }
        if (!inside(parsed.lat, parsed.lon)) {
            if (window.MyRoutes) MyRoutes.toast(`${parsed.interpretation} — за пределами карты Сербии`);
            return true;
        }
        show(parsed.lat, parsed.lon, parsed.interpretation, true);
        return true;
    }

    // ── Долгое нажатие ──────────────────────────────────────────────────────

    const LONG_PRESS_MS = 550;
    let lastLongPress = 0;

    const blocked = () => (window.RouteBuilder && RouteBuilder.active) ||
        document.body.classList.contains('tw-immersive');

    function fire(lngLat) {
        if (blocked()) return;
        lastLongPress = performance.now();
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
        // Камеру не двигаем: точку показали пальцем, она и так в кадре
        show(lngLat.lat, lngLat.lng, null, false);
    }

    function init() {
        const m = window.map;
        if (!m) return;

        // Палец: держим на месте, одним пальцем
        let timer = null, start = null;
        const cancel = () => { clearTimeout(timer); timer = null; };
        m.on('touchstart', e => {
            cancel();
            if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) return;
            start = e.point;
            const lngLat = e.lngLat;
            timer = setTimeout(() => { timer = null; fire(lngLat); }, LONG_PRESS_MS);
        });
        m.on('touchmove', e => {
            if (timer && start && (Math.abs(e.point.x - start.x) > 10 || Math.abs(e.point.y - start.y) > 10)) cancel();
        });
        m.on('touchend', cancel);
        m.on('touchcancel', cancel);
        m.on('movestart', e => { if (e.originalEvent) cancel(); });

        // Мышь: правый клик. Правой кнопкой Mapbox вращает карту, поэтому
        // клик после протяжки — это конец вращения, а не вопрос про точку
        let rightDown = null;
        m.getCanvasContainer().addEventListener('mousedown', e => {
            if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
        });
        m.on('contextmenu', e => {
            // Android присылает contextmenu и на долгое касание — второй раз не надо
            if (performance.now() - lastLongPress < 800) return;
            const o = e.originalEvent;
            if (rightDown && o && Math.hypot(o.clientX - rightDown.x, o.clientY - rightDown.y) > 5) return;
            fire(e.lngLat);
        });

        // Обычный клик мимо — убрать точку. Но не тот, что пришёл следом за
        // долгим нажатием: отпускание пальца Mapbox тоже считает кликом
        m.on('click', () => {
            if (!point || performance.now() - lastLongPress < 800) return;
            clear();
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && point) clear(); });
    }

    root.PointInsight = { show, clear, searchCoordinates, parse };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof globalThis !== 'undefined' ? globalThis : window);
