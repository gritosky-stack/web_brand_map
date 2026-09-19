/**
 * «Нарисовать» — прокладка своего маршрута по тропам. Порт конструктора из
 * приложения: `AppState` (опорные точки, отрезки, история), `TrailRouter`,
 * `TrailSnapService`, `RoutingPreferences`, экраны `RouteConstructorView`,
 * `ConstructorAimLayer`, `SaveRouteSheet`, `RoutingPreferencesView`.
 * Устройство и грабли — `hikingmap/CLAUDE.md`, «Прокладка маршрута по тропам».
 *
 * Инвариант тот же, что в приложении: отрезков ровно на один меньше, чем
 * точек, `legs[i]` ведёт из точки `i` в `i + 1`. Километры, набор и
 * сохранение берутся из отрезков, а не из точек: по прямой маршрут заметно
 * короче настоящего.
 *
 * Сохраняется нарисованное тем же `payload` (`CustomRoute`), что и в
 * приложении, через `MyRoutes.saveDrawn` (account.js) — поэтому маршрут сам
 * появляется во «Мои» и на телефоне.
 *
 * Чего нет по сравнению с приложением: офлайн-графа `TrailGraph`. Сайт без
 * сети не работает вовсе, так что при отказе обоих роутеров отрезок честно
 * ложится прямой.
 *
 * Координаты везде — `[lon, lat]`, как у Mapbox.
 */
(function () {
    'use strict';

    const LINE_COLOR     = '#FF8C1A';    // линия конструктора, как в приложении
    const TRAILS_COLOR   = '#59D96B';    // тропы OSM под рисованием (DS.osmUI)
    const SNAP_M         = 100;          // TrailSnapService.snapRadiusMeters
    const ANCHOR_SNAP_M  = 150;          // TrailRouter.anchorSnapMeters
    const MIN_LEG_M      = 20;           // TrailRouter.minLegMeters
    const TIMEOUT_MS     = 12000;
    const MAX_HISTORY    = 60;
    const TRAIL_CLASSES  = ['path', 'track', 'footway', 'steps', 'pedestrian'];
    const PREFS_KEY      = 'tw-routing-prefs';
    const DRAFT_KEY      = 'tw-route-draft';

    // ── Правила маршрута (RoutingPreferences) ───────────────────────────────

    // Значения по умолчанию — то, что зашито в `hiking-beta`: пока экран
    // правил не открывали, прокладка ведёт себя как на brouter.de. Какие
    // переменные профиль реально знает — см. комментарий в RoutingPreferences.swift.
    const DEFAULT_PREFS = Object.freeze({
        preferForest: false, preferWater: false, avoidTowns: false, avoidNoise: false,
        minimizeElevation: true, avoidMud: false, allowSteps: true, allowFerries: true,
        trailPreference: 0.2, maxDifficulty: 3
    });

    const SAC_LEVELS = [
        [1, 'Прогулочная тропа',  'Широкая тропа, обвалов и перил нет'],
        [2, 'Горная тропа',       'Местами узко и круто, нужна устойчивость'],
        [3, 'Горный поход',       'Возможны участки, где держатся руками'],
        [4, 'Альпийская тропа',   'Скалы, может понадобиться снаряжение'],
        [5, 'Сложная альпийская', 'Сложный альпинистский рельеф'],
        [6, 'Экстремальная',      'Экстремально сложный, только для экспертов']
    ];

    function loadPrefs() {
        try {
            const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
            if (saved && typeof saved === 'object') return Object.assign({}, DEFAULT_PREFS, saved);
        } catch (e) {}
        return Object.assign({}, DEFAULT_PREFS);
    }

    function storePrefs() {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
    }

    function prefsCustomized() {
        return Object.keys(DEFAULT_PREFS).some(k =>
            k === 'trailPreference' ? Math.abs(prefs[k] - DEFAULT_PREFS[k]) >= 0.01 : prefs[k] !== DEFAULT_PREFS[k]);
    }

    /** `profile:<имя>=<значение>` — шлём всегда и целиком, как приложение. */
    function brouterParams(p) {
        const b = v => (v ? '1' : '0');
        return {
            'profile:consider_forest': b(p.preferForest),
            'profile:consider_river': b(p.preferWater),
            'profile:consider_town': b(p.avoidTowns),
            'profile:consider_noise': b(p.avoidNoise),
            'profile:consider_elevation': b(p.minimizeElevation),
            'profile:iswet': b(p.avoidMud),
            'profile:allow_steps': b(p.allowSteps),
            'profile:allow_ferries': b(p.allowFerries),
            'profile:hiking_routes_preference': Number(p.trailPreference).toFixed(2),
            'profile:SAC_scale_limit': String(p.maxDifficulty),
            'profile:SAC_scale_preferred': '1'
        };
    }

    // ── Геометрия ───────────────────────────────────────────────────────────

    function meters(a, b) {
        const R = 6371008.8, rad = Math.PI / 180;
        const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
        const h = Math.sin(dLat / 2) ** 2 +
                  Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function pathLength(path) {
        let total = 0;
        for (let i = 1; i < path.length; i++) total += meters(path[i - 1], path[i]);
        return total;
    }

    /** Плоское приближение — на сотне метров ошибка меньше полупроцента. */
    function planarMeters(a, b) {
        const midLat = (a[1] + b[1]) * 0.5 * Math.PI / 180;
        const dx = (b[0] - a[0]) * 111320 * Math.cos(midLat);
        const dy = (b[1] - a[1]) * 110540;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function nearestOnSegment(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq <= 1e-14) return a;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
        return [a[0] + t * dx, a[1] + t * dy];
    }

    // ── Тропы для притяжения ────────────────────────────────────────────────

    // Маршруты ПСС из того же файла, что слой pss_layer.js, — плоским списком
    // отрезков. Грузим, только когда начали рисовать.
    let pssSegments = null;
    let pssLoading = null;
    function ensurePSSSegments() {
        if (pssSegments || pssLoading) return;
        pssLoading = fetch('pss_routes_web.geojson')
            .then(r => (r.ok ? r.json() : { features: [] }))
            .then(gj => {
                const segs = [];
                for (const f of gj.features || []) {
                    const g = f.geometry || {};
                    const lines = g.type === 'LineString' ? [g.coordinates]
                        : g.type === 'MultiLineString' ? g.coordinates : [];
                    for (const line of lines) {
                        for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i]]);
                    }
                }
                pssSegments = segs;
            })
            .catch(() => { pssSegments = []; });
    }

    /**
     * Ближайшая точка на тропе в радиусе 100 м или null. Тропы — ПСС плюс
     * `path/track/footway/steps/pedestrian` из **уже загруженных** векторных
     * тайлов, как `osmTrailSegments` в приложении.
     */
    function snapToTrail(p) {
        let best = null, bestDist = SNAP_M;
        const dLat = SNAP_M / 110540;
        const dLon = SNAP_M / (111320 * Math.max(0.2, Math.cos(p[1] * Math.PI / 180)));
        const consider = (a, b) => {
            if (Math.min(a[1], b[1]) > p[1] + dLat || Math.max(a[1], b[1]) < p[1] - dLat) return;
            if (Math.min(a[0], b[0]) > p[0] + dLon || Math.max(a[0], b[0]) < p[0] - dLon) return;
            const c = nearestOnSegment(p, a, b);
            const d = planarMeters(p, c);
            if (d < bestDist) { bestDist = d; best = c; }
        };

        if (map.getSource('composite')) {
            let features = [];
            try {
                features = map.querySourceFeatures('composite', {
                    sourceLayer: 'road',
                    filter: ['any',
                        ['in', ['get', 'class'], ['literal', TRAIL_CLASSES]],
                        ['in', ['get', 'type'], ['literal', TRAIL_CLASSES]]]
                });
            } catch (e) {}
            for (const f of features) {
                const g = f.geometry;
                const lines = g.type === 'LineString' ? [g.coordinates]
                    : g.type === 'MultiLineString' ? g.coordinates : [];
                for (const line of lines) {
                    for (let i = 1; i < line.length; i++) consider(line[i - 1], line[i]);
                }
            }
        }
        for (const [a, b] of pssSegments || []) consider(a, b);
        return best;
    }

    // ── Роутер (TrailRouter) ────────────────────────────────────────────────

    async function getJSON(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) return null;
            // При ошибке BRouter отвечает текстом с тем же кодом 200 — разбор
            // JSON и есть проверка успеха
            return JSON.parse(await res.text());
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    const fmt = v => v.toFixed(6);

    /** BRouter кладёт высоту третьим числом каждой точки — берём её сразу. */
    async function brouter(a, b, p) {
        const q = new URLSearchParams(Object.assign({
            lonlats: `${fmt(a[0])},${fmt(a[1])}|${fmt(b[0])},${fmt(b[1])}`,
            profile: 'hiking-beta', alternativeidx: '0', format: 'geojson'
        }, brouterParams(p)));
        const json = await getJSON('https://brouter.de/brouter?' + q.toString());
        const raw = json && json.features && json.features[0] && json.features[0].geometry
            && json.features[0].geometry.coordinates;
        if (!Array.isArray(raw)) return null;
        const path = raw.filter(c => isFinite(c[0]) && isFinite(c[1])).map(c => [c[0], c[1]]);
        if (path.length < 2) return null;
        const ele = raw.filter(c => c.length >= 3 && isFinite(c[2])).map(c => c[2]);
        return { path, ele: ele.length === path.length ? ele : null };
    }

    async function osrmFoot(a, b) {
        const pair = `${fmt(a[0])},${fmt(a[1])};${fmt(b[0])},${fmt(b[1])}`;
        const json = await getJSON('https://routing.openstreetmap.de/routed-foot/route/v1/foot/' +
                                   pair + '?overview=full&geometries=geojson');
        if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) return null;
        const raw = json.routes[0].geometry && json.routes[0].geometry.coordinates;
        if (!Array.isArray(raw)) return null;
        const path = raw.map(c => [c[0], c[1]]);
        return path.length >= 2 ? { path, ele: null } : null;   // OSRM высот не отдаёт
    }

    /** Отсекает бред роутера: без тропы он охотно уводит в обход горы. */
    function plausible(path, straight) {
        return path.length >= 2 && pathLength(path) <= straight * 12 + 3000;
    }

    /** Сеть → прямая. `{ kind: 'trail', path, ele }` или `{ kind: 'straight' }`. */
    async function routeBetween(a, b, p) {
        const straight = meters(a, b);
        if (straight <= MIN_LEG_M) return { kind: 'straight' };
        if (navigator.onLine !== false) {
            const r = (await brouter(a, b, p)) || (await osrmFoot(a, b));
            if (r && plausible(r.path, straight)) return { kind: 'trail', path: r.path, ele: r.ele };
        }
        return { kind: 'straight' };
    }

    // ── Состояние (AppState) ────────────────────────────────────────────────

    let active = false;
    let snapEnabled = true;
    let prefs = loadPrefs();
    let waypoints = [];     // [lon, lat] — куда ткнули (с поправкой на притяжение)
    let legs = [];          // { id, path, kind: pending|trail|straight, dist, ele }
    let undoStack = [];
    let redoStack = [];
    let legSeq = 0;

    const isRouting   = () => legs.some(l => l.kind === 'pending');
    const hasStraight = () => legs.some(l => l.kind === 'straight');
    const distanceKm  = () => legs.reduce((s, l) => s + l.dist, 0) / 1000;

    /** Вся нарисованная линия — склейка отрезков, а не опорные точки. */
    function fullPath() {
        if (!legs.length) return waypoints.slice();
        const path = [];
        for (const l of legs) path.push(...(path.length ? l.path.slice(1) : l.path));
        return path;
    }

    /** Высоты вдоль всей линии. null, если хоть у одного отрезка их нет. */
    function elevationProfile() {
        if (!legs.length) return null;
        const out = [];
        for (const l of legs) {
            if (!l.ele || l.ele.length !== l.path.length) return null;
            out.push(...(out.length ? l.ele.slice(1) : l.ele));
        }
        return out.length >= 2 ? out : null;
    }

    /**
     * Набор и сброс — `AppState.climb`: скользящее среднее ±4 точки и отсечка
     * мелочи, иначе из шума DEM за десять километров набегает лишняя сотня.
     */
    function climb(profile) {
        if (!profile || profile.length < 2) return null;
        const half = 4;
        const sm = profile.map((_, i) => {
            const lo = Math.max(0, i - half), hi = Math.min(profile.length - 1, i + half);
            let s = 0;
            for (let j = lo; j <= hi; j++) s += profile[j];
            return s / (hi - lo + 1);
        });
        let ascent = 0, descent = 0;
        for (let i = 1; i < sm.length; i++) {
            const d = sm[i] - sm[i - 1];
            if (d > 0.3) ascent += d; else if (d < -0.3) descent -= d;
        }
        return { ascent, descent };
    }

    const cloneLegs = ls => ls.map(l => Object.assign({}, l));
    const snapshot  = () => ({ waypoints: waypoints.map(w => w.slice()), legs: cloneLegs(legs) });

    /** Снимок перед изменением. Любое новое действие обрубает «вперёд». */
    function recordHistory() {
        undoStack.push(snapshot());
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
    }

    function applySnapshot(s) {
        waypoints = s.waypoints.map(w => w.slice());
        legs = cloneLegs(s.legs);
        // В снимок мог попасть отрезок, который тогда ещё прокладывался:
        // задача, считавшая его, в это состояние уже не вернётся
        for (const l of legs) if (l.kind === 'pending') routeLeg(l.id, l.path[0], l.path[l.path.length - 1]);
        changed();
    }

    function undo() {
        if (!undoStack.length) return;
        redoStack.push(snapshot());
        applySnapshot(undoStack.pop());
    }

    function redo() {
        if (!redoStack.length) return;
        undoStack.push(snapshot());
        applySnapshot(redoStack.pop());
    }

    function reset() {
        waypoints = []; legs = []; undoStack = []; redoStack = [];
    }

    /** Ставит точку и сразу прокладывает к ней путь от предыдущей. */
    function addWaypoint(p) {
        recordHistory();
        const prev = waypoints[waypoints.length - 1];
        waypoints.push(p);
        if (prev) {
            const leg = { id: ++legSeq, path: [prev, p], kind: snapEnabled ? 'pending' : 'straight',
                          dist: meters(prev, p), ele: null };
            legs.push(leg);
            if (snapEnabled) routeLeg(leg.id, prev, p);
            else fillLegElevations(legs.length - 1);
        }
        changed();
    }

    function routeLeg(id, from, to) {
        const p = Object.assign({}, prefs);
        routeBetween(from, to, p).then(outcome => applyLegOutcome(id, outcome, from, to));
    }

    function applyLegOutcome(id, outcome, from, to) {
        // Отрезок могли отменить или начать заново, пока роутер думал
        const idx = legs.findIndex(l => l.id === id);
        if (idx < 0 || !active) return;
        const leg = legs[idx];

        if (outcome.kind !== 'trail' || outcome.path.length < 2) {
            leg.path = [from, to]; leg.kind = 'straight'; leg.ele = null;
        } else {
            const geom = outcome.path.slice();
            let ele = outcome.ele && outcome.ele.length === geom.length ? outcome.ele.slice() : null;
            const head = geom[0], tail = geom[geom.length - 1];
            // Начало отрезка не двигаем: на нём уже висит предыдущий. Первую
            // точку маршрута — можно, к ней ничего не пришито.
            if (idx === 0 && meters(head, from) <= ANCHOR_SNAP_M) {
                waypoints[0] = head;
            } else if (meters(head, from) > 1) {
                geom.unshift(from);
                if (ele) ele.unshift(ele[0]);   // «подводка» к тропе — метры, на набор не влияют
            }
            // Конец: роутер сел на тропу рядом — принимаем притяжение. Далеко
            // или отрезок уже не последний — дотягиваем прямой.
            const end = idx + 1;
            const isLast = idx === legs.length - 1 && end === waypoints.length - 1;
            if (isLast && meters(tail, to) <= ANCHOR_SNAP_M) {
                waypoints[end] = tail;
            } else if (meters(tail, to) > 1) {
                geom.push(to);
                if (ele) ele.push(ele[ele.length - 1]);
            }
            leg.path = geom; leg.kind = 'trail'; leg.ele = ele;
        }
        leg.dist = pathLength(leg.path);
        fillLegElevations(idx);
        changed();
    }

    /** Высота рельефа карты — тот же DEM, что под `setTerrain`. */
    function terrainElevation(p) {
        try {
            const v = map.queryTerrainElevation(p, { exaggerated: false });
            return v == null || !isFinite(v) ? null : v;
        } catch (e) { return null; }
    }

    /** Высоты, которых не дал роутер, — с рельефа. Хоть одной нет — null. */
    function fillLegElevations(i) {
        const leg = legs[i];
        if (!leg || leg.ele) return;
        const ele = [];
        for (const p of leg.path) {
            const v = terrainElevation(p);
            if (v == null) return;
            ele.push(v);
        }
        leg.ele = ele;
    }

    // ── Карта ───────────────────────────────────────────────────────────────

    const EMPTY = { type: 'FeatureCollection', features: [] };

    function ensureLayers() {
        const before = window.drapeBeforeId && drapeBeforeId();
        if (!map.getLayer('builder-osm-trails') && map.getSource('composite')) {
            // Тропы из тайлов стиля (в самом стиле мы их прячем): видно, куда
            // прицеливаться, и именно к ним притягивается точка
            map.addLayer({
                id: 'builder-osm-trails', type: 'line', source: 'composite', 'source-layer': 'road',
                minzoom: 11,
                filter: ['any',
                    ['in', ['get', 'class'], ['literal', TRAIL_CLASSES]],
                    ['in', ['get', 'type'], ['literal', TRAIL_CLASSES]]],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': TRAILS_COLOR, 'line-opacity': 0.75,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 1.8, 18, 3]
                }
            }, before);
        }
        if (!map.getSource('builder-lines')) {
            map.addSource('builder-lines', { type: 'geojson', data: EMPTY });
            map.addSource('builder-dots', { type: 'geojson', data: EMPTY });
            // Тропы сплошной линией, прямые куски — пунктиром: сразу видно,
            // где маршрут лёг на тропу, а где пошёл напрямик
            map.addLayer({
                id: 'builder-line-trail', type: 'line', source: 'builder-lines',
                filter: ['==', ['get', 'kind'], 'trail'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': LINE_COLOR, 'line-width': 4 }
            }, before);
            map.addLayer({
                id: 'builder-line-straight', type: 'line', source: 'builder-lines',
                filter: ['!=', ['get', 'kind'], 'trail'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': LINE_COLOR, 'line-opacity': 0.75, 'line-width': 3,
                         'line-dasharray': [1.3, 1] }
            }, before);
            map.addLayer({
                id: 'builder-dots', type: 'circle', source: 'builder-dots',
                paint: {
                    'circle-radius': ['case', ['get', 'first'], 8.5, 5.5],
                    'circle-color': LINE_COLOR,
                    'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
                    'circle-pitch-alignment': 'map'
                }
            });
        }
    }

    function removeLayers() {
        ['builder-dots', 'builder-line-straight', 'builder-line-trail', 'builder-osm-trails']
            .forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        ['builder-dots', 'builder-lines'].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    }

    function drawOnMap() {
        if (!map.getSource('builder-lines')) return;
        map.getSource('builder-lines').setData({
            type: 'FeatureCollection',
            features: legs.filter(l => l.path.length >= 2).map(l => ({
                type: 'Feature', properties: { kind: l.kind },
                geometry: { type: 'LineString', coordinates: l.path }
            }))
        });
        map.getSource('builder-dots').setData({
            type: 'FeatureCollection',
            features: waypoints.map((w, i) => ({
                type: 'Feature', properties: { first: i === 0 },
                geometry: { type: 'Point', coordinates: w }
            }))
        });
    }

    /** Середина кадра — у нас отступы нулевые, но берём от холста, как приложение. */
    function screenCenter() {
        const c = map.getContainer();
        return [c.clientWidth / 2, c.clientHeight / 2];
    }

    /** «Резинка» от последней точки к прицелу — экранные координаты, каждый кадр. */
    function updateAim() {
        const band = document.getElementById('rb-band');
        if (!band) return;
        const [cx, cy] = screenCenter();
        const last = waypoints[waypoints.length - 1];
        if (!active || !last) { band.style.display = 'none'; return; }
        // project() в Mapbox GL JS к краю не прижимает — опора за кадром даёт
        // честную точку за кадром
        const p = map.project(last);
        if (!isFinite(p.x) || !isFinite(p.y)) { band.style.display = 'none'; return; }
        band.style.display = '';
        band.querySelectorAll('line').forEach(l => {
            l.setAttribute('x1', p.x); l.setAttribute('y1', p.y);
            l.setAttribute('x2', cx);  l.setAttribute('y2', cy);
        });
    }

    // ── Жесты ───────────────────────────────────────────────────────────────

    // Жест не должен ставить точку: сдвиг, зум, поворот заканчиваются
    // отпусканием, и ещё 0.35 с после них клик игнорируем. Двойной клик —
    // это зум, а не две точки, поэтому одиночный ждёт, не придёт ли второй.
    let lastGestureEnd = 0;
    let clickTimer = null;

    function onGestureEnd(e) { if (e && e.originalEvent) lastGestureEnd = performance.now(); }

    function onMapClick(e) {
        if (!active) return;
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        if (performance.now() - lastGestureEnd < 350) return;
        const p = [e.lngLat.lng, e.lngLat.lat];
        clickTimer = setTimeout(() => {
            clickTimer = null;
            place(p, 8);
        }, 260);
    }

    function place(p, vibrate) {
        let placed = p;
        if (snapEnabled) {
            const s = snapToTrail(p);
            if (s) placed = s;
        }
        if (navigator.vibrate) try { navigator.vibrate(vibrate); } catch (e) {}
        addWaypoint(placed);
    }

    /** «Шаг» — точка под прицел, тем же путём, что и тап. */
    function step() {
        const c = map.unproject(screenCenter());
        place([c.lng, c.lat], 14);
    }

    function onKey(e) {
        if (!active || e.target.closest && e.target.closest('input, textarea')) return;
        if (document.querySelector('#rb-save.open, #rb-prefs.open')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.shiftKey ? redo() : undo();
        } else if (mod && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
        }
    }

    // ── Интерфейс ───────────────────────────────────────────────────────────

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const ICONS = {
        close:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        sliders:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
        bolt:   '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
        undo:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
        redo:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>',
        pin:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-11a6 6 0 0112 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
        plus:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
        check:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        route:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h7a3.5 3.5 0 010 7H10a3.5 3.5 0 000 7h7"/></svg>',
        warn:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.01"/></svg>'
    };

    /** «1 точка», «2 точки», «5 точек» */
    function pointsWord(n) {
        const tail = n % 100;
        if (tail >= 11 && tail <= 14) return 'точек';
        const d = n % 10;
        return d === 1 ? 'точка' : d >= 2 && d <= 4 ? 'точки' : 'точек';
    }

    function autoName() {
        const d = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
        return 'Маршрут ' + d.replace(/\s*г\.?$/, '');
    }

    const finePointer = () => window.matchMedia && matchMedia('(pointer: fine)').matches;

    function buildDOM() {
        if (document.getElementById('rb-root')) return;
        const root = document.createElement('div');
        root.id = 'rb-root';
        root.innerHTML = `
            <svg id="rb-aim-svg" aria-hidden="true">
                <g id="rb-band" style="display:none">
                    <line class="rb-band-shadow"/><line class="rb-band-line"/>
                </g>
            </svg>
            <div id="rb-crosshair" aria-hidden="true">
                <div class="rb-ring"></div>
                <div class="rb-ticks"><i></i><i></i><i></i><i></i></div>
                <div class="rb-dot"></div>
            </div>
            <div id="rb-modebar">
                <span class="rb-mode-label"><i></i>РИСУЮ МАРШРУТ</span>
                <span class="rb-spacer"></span>
                <button id="rb-btn-prefs" class="rb-chip" title="Правила маршрута" aria-label="Правила маршрута">${ICONS.sliders}</button>
                <button id="rb-btn-snap" class="rb-chip" title="Прокладывать по тропам">${ICONS.bolt}<span>По тропам</span></button>
                <button id="rb-btn-stop" class="rb-chip rb-chip-stop">${ICONS.close}<span>Стоп</span></button>
            </div>
            <div id="rb-bottom">
                <div id="rb-stats" class="rb-card hidden">
                    <div class="rb-stats-row">
                        <span class="rb-stat"><em>↔</em><b id="rb-km">0.0</b><small>км</small></span>
                        <span class="rb-div"></span>
                        <span class="rb-stat"><em>📍</em><b id="rb-pts">0</b><small id="rb-pts-word">точек</small></span>
                        <span class="rb-div"></span>
                        <span class="rb-stat"><em>↑</em><b id="rb-up">—</b><small>м</small></span>
                        <span class="rb-div"></span>
                        <span class="rb-stat"><em>↓</em><b id="rb-down">—</b><small>м</small></span>
                    </div>
                    <div id="rb-time" class="rb-time hidden"></div>
                    <button id="rb-btn-done" class="rb-done hidden">${ICONS.check}<span>Готово</span></button>
                </div>
                <div id="rb-status" class="rb-pill hidden"></div>
                <div id="rb-hint" class="rb-pill"></div>
                <div class="rb-controls">
                    <button id="rb-btn-undo" class="rb-hist" aria-label="Отменить" title="Отменить (⌘Z)">${ICONS.undo}</button>
                    <button id="rb-btn-redo" class="rb-hist hidden" aria-label="Вернуть" title="Вернуть (⇧⌘Z)">${ICONS.redo}</button>
                    <button id="rb-btn-step" class="rb-step"></button>
                </div>
            </div>
            <div id="rb-save" class="tw-modal"><div class="tw-modal-inner rb-sheet" id="rb-save-inner"></div></div>
            <div id="rb-prefs" class="tw-modal"><div class="tw-modal-inner rb-sheet rb-prefs-sheet" id="rb-prefs-inner"></div></div>`;
        document.body.appendChild(root);

        const $ = id => document.getElementById(id);
        $('rb-btn-stop').onclick = () => stop();
        $('rb-btn-snap').onclick = () => { snapEnabled = !snapEnabled; render(); };
        $('rb-btn-prefs').onclick = openPrefs;
        $('rb-btn-undo').onclick = undo;
        $('rb-btn-redo').onclick = redo;
        $('rb-btn-step').onclick = step;
        $('rb-btn-done').onclick = () => openSave(autoName());
        $('rb-save').onclick = e => { if (e.target.id === 'rb-save') closeSave(); };
        $('rb-prefs').onclick = e => { if (e.target.id === 'rb-prefs') closePrefs(); };
    }

    function render() {
        if (!document.getElementById('rb-root')) return;
        const $ = id => document.getElementById(id);
        const n = waypoints.length;
        const km = distanceKm();
        const c = climb(elevationProfile());

        $('rb-stats').classList.toggle('hidden', n < 1);
        $('rb-km').textContent = km.toFixed(1);
        $('rb-pts').textContent = n;
        $('rb-pts-word').textContent = pointsWord(n);
        // Высот нет — прочерк, а не ноль: ноль читался бы как «ровная дорога»
        $('rb-up').textContent = c ? Math.round(c.ascent) : '—';
        $('rb-down').textContent = c ? Math.round(c.descent) : '—';
        // Время — сразу, как маршрут перестал быть точкой: именно оно решает,
        // влезет ли задумка в день. Набора пока нет — считаем по одной длине.
        $('rb-time').classList.toggle('hidden', n < 2);
        if (n >= 2 && window.HikingTime) {
            $('rb-time').textContent = `≈ ${HikingTime.format(HikingTime.minutes(km, c ? c.ascent : 0))} в пути`;
        }
        const done = $('rb-btn-done');
        done.classList.toggle('hidden', n < 2);
        // Пока роутер думает, сохранять нельзя — в маршрут ушла бы времянка
        done.disabled = n < 2 || isRouting();

        const status = $('rb-status');
        if (isRouting()) {
            status.className = 'rb-pill rb-pill-accent';
            status.innerHTML = `${ICONS.route}<span>Прокладываю по тропам…</span>`;
        } else if (hasStraight()) {
            status.className = 'rb-pill';
            status.innerHTML = `${ICONS.warn}<span>${snapEnabled ? 'Часть пути — напрямик: троп рядом нет'
                                                                 : 'Прокладка по тропам выключена'}</span>`;
        } else {
            status.className = 'rb-pill hidden';
        }

        const hint = $('rb-hint');
        hint.classList.toggle('hidden', n > 0);
        hint.textContent = `Наведи прицел и нажми «Старт» — или ${finePointer() ? 'кликни' : 'тапни'} по карте`;

        $('rb-btn-undo').disabled = !undoStack.length;
        $('rb-btn-redo').classList.toggle('hidden', !redoStack.length);
        $('rb-btn-step').innerHTML = n === 0 ? `${ICONS.pin}<span>Старт</span>` : `${ICONS.plus}<span>Шаг</span>`;

        $('rb-btn-snap').classList.toggle('on', snapEnabled);
        $('rb-btn-prefs').classList.toggle('on', prefsCustomized());
    }

    function changed() {
        drawOnMap();
        updateAim();
        render();
    }

    // ── Сохранение (SaveRouteSheet) ─────────────────────────────────────────

    let saving = false;

    function openSave(name) {
        const box = document.getElementById('rb-save-inner');
        const n = waypoints.length;
        const acc = window.Account && Account.status ? Account.status() : 'unavailable';
        const primary = acc === 'signedIn'
            ? `<button class="rb-btn rb-btn-accent" id="rb-save-go">Сохранить</button>`
            : acc === 'unavailable'
                ? `<button class="rb-btn rb-btn-accent" id="rb-save-gpx">Скачать GPX</button>`
                : `<button class="rb-btn rb-btn-accent" id="rb-save-login">Войти и сохранить</button>`;
        const note = acc === 'signedIn'
            ? 'Маршрут появится во «Мои» — и здесь, и в приложении.'
            : acc === 'unavailable'
                ? 'Сохранение в профиль здесь недоступно — сохраните маршрут файлом.'
                : 'Маршрут сохранится в профиль — тот же, что в приложении. Нарисованное не потеряется.';
        box.innerHTML = `
            <div class="rb-sheet-title">Сохранить маршрут</div>
            <div class="rb-sheet-stats"><span>↔ ${distanceKm().toFixed(1)} км</span><span>📍 ${n} ${pointsWord(n)}</span></div>
            <label class="rb-field-label" for="rb-name">НАЗВАНИЕ</label>
            <input id="rb-name" class="rb-input" maxlength="120" autocomplete="off" value="${esc(name)}">
            <div class="rb-sheet-buttons">
                <button class="rb-btn rb-btn-ghost" id="rb-save-cancel">Отмена</button>
                ${primary}
            </div>
            <p class="tw-note rb-sheet-note">${note}</p>`;
        document.getElementById('rb-save').classList.add('open');
        const input = document.getElementById('rb-name');
        const nameValue = () => input.value.trim().slice(0, 120) || autoName();
        setTimeout(() => { input.focus(); input.select(); }, 50);

        document.getElementById('rb-save-cancel').onclick = closeSave;
        const go = document.getElementById('rb-save-go');
        if (go) go.onclick = () => commitSave(nameValue());
        const gpx = document.getElementById('rb-save-gpx');
        if (gpx) gpx.onclick = () => { downloadGPX(buildPayload(nameValue())); closeSave(); };
        const login = document.getElementById('rb-save-login');
        if (login) login.onclick = () => {
            // Google уводит со страницы: нарисованное ждёт в sessionStorage
            // и после возврата открывается сразу с этим окном
            storeDraft(nameValue());
            Account.signInWithGoogle();
        };
        input.onkeydown = e => {
            if (e.key === 'Enter') (go || gpx || login).click();
            if (e.key === 'Escape') closeSave();
        };
    }

    function closeSave() {
        document.getElementById('rb-save').classList.remove('open');
    }

    /** `payload` = `CustomRoute` приложения, поля ровно те же. */
    function buildPayload(name) {
        const path = fullPath();
        const now = new Date().toISOString();
        const p = {
            id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).toUpperCase(),
            name, date: now,
            waypointLats: path.map(c => c[1]),
            waypointLons: path.map(c => c[0]),
            distanceKm: distanceKm(),
            updatedAt: now
        };
        // Высоты уже собраны, пока рисовали. Нет у части отрезков — снимаем
        // с рельефа всю линию разом; хоть одной точки нет — сохраняем без них
        let ele = elevationProfile();
        if (!ele || ele.length !== path.length) {
            ele = path.map(terrainElevation);
            if (ele.some(v => v == null)) ele = null;
        }
        if (ele) p.elevations = ele.map(v => Math.round(v * 10) / 10);
        return p;
    }

    async function commitSave(name) {
        if (saving) return;
        saving = true;
        const btn = document.getElementById('rb-save-go');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
        const payload = buildPayload(name);
        try {
            await MyRoutes.saveDrawn(payload, () => stop(true));
            closeSave();
        } catch (e) {
            console.warn('[builder] сохранение:', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
            toast('Не удалось сохранить маршрут');
        } finally {
            saving = false;
        }
    }

    function downloadGPX(p) {
        const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<gpx version="1.1" creator="HikingMap – Totskii Wild" xmlns="http://www.topografix.com/GPX/1/1">\n' +
            `  <trk>\n    <name>${xmlEsc(p.name)}</name>\n    <trkseg>`;
        p.waypointLats.forEach((lat, i) => {
            const e = p.elevations ? `\n        <ele>${p.elevations[i].toFixed(1)}</ele>` : '';
            xml += `\n      <trkpt lat="${lat.toFixed(7)}" lon="${p.waypointLons[i].toFixed(7)}">${e}\n      </trkpt>`;
        });
        xml += '\n    </trkseg>\n  </trk>\n</gpx>';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
        a.download = p.name.replace(/[\\/:*?"<>|]/g, '_') + '.gpx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function toast(text) {
        if (window.MyRoutes && MyRoutes.toast) MyRoutes.toast(text);
        else console.warn(text);
    }

    // ── Черновик на время входа через Google ────────────────────────────────

    function storeDraft(name) {
        try {
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
                name, snap: snapEnabled, waypoints,
                legs: legs.map(l => ({ path: l.path, kind: l.kind, ele: l.ele }))
            }));
        } catch (e) {}
    }

    function takeDraft() {
        try {
            const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
            sessionStorage.removeItem(DRAFT_KEY);
            return d && Array.isArray(d.waypoints) && d.waypoints.length ? d : null;
        } catch (e) { return null; }
    }

    function restoreDraft(d) {
        start({ keepCamera: true });
        snapEnabled = d.snap !== false;
        waypoints = d.waypoints;
        legs = (d.legs || []).map(l => ({ id: ++legSeq, path: l.path, kind: l.kind, ele: l.ele,
                                          dist: pathLength(l.path) }));
        for (const l of legs) if (l.kind === 'pending') routeLeg(l.id, l.path[0], l.path[l.path.length - 1]);
        const pts = fullPath();
        if (pts.length >= 2) {
            const b = pts.reduce((bb, c) => bb.extend(c), new mapboxgl.LngLatBounds(pts[0], pts[0]));
            map.fitBounds(b, { padding: 80, pitch: 0, duration: 0 });
        }
        changed();
        const signedIn = () => window.Account && Account.status && Account.status() === 'signedIn';
        // Вернулись от Google: как только сессия поднялась — сразу окно
        // сохранения с тем же названием. Не вошли — просто рисуем дальше.
        const tryOpen = () => { if (active && signedIn()) openSave(d.name || autoName()); };
        if (signedIn()) tryOpen();
        else document.addEventListener('tw-account', function once(e) {
            if (e.detail && e.detail.state === 'loading') return;
            document.removeEventListener('tw-account', once);
            tryOpen();
        });
    }

    // ── Правила маршрута (RoutingPreferencesView) ───────────────────────────

    function openPrefs() {
        renderPrefs();
        document.getElementById('rb-prefs').classList.add('open');
    }

    function closePrefs() {
        document.getElementById('rb-prefs').classList.remove('open');
    }

    function renderPrefs() {
        const box = document.getElementById('rb-prefs-inner');
        const card = (icon, title, sub, body) => `
            <div class="rb-pcard">
                <div class="rb-pcard-title"><span class="rb-pcard-icon">${icon}</span>
                    <div><div class="rb-pcard-h">${title}</div><div class="rb-pcard-sub">${sub}</div></div></div>
                ${body}
            </div>`;
        const toggle = (key, title, sub) => `
            <label class="rb-toggle-row"><span><b>${title}</b><small>${sub}</small></span>
                <input type="checkbox" class="layer-switch rb-switch" data-key="${key}" ${prefs[key] ? 'checked' : ''}></label>`;
        const levels = SAC_LEVELS.map(([v, label, hint]) => `
            <button class="rb-level ${prefs.maxDifficulty === v ? 'on' : ''}" data-level="${v}">
                <span class="rb-radio"></span><span><b>${label}</b><small>${hint}</small></span></button>`).join('');
        const tp = [[0.1, 'Можно срезать'], [0.2, 'Обычно'], [1.0, 'Только тропы']].map(([v, l]) =>
            `<button class="rb-seg ${Math.abs(prefs.trailPreference - v) < 0.01 ? 'on' : ''}" data-tp="${v}">${l}</button>`).join('');

        box.innerHTML = `
            <div class="rb-prefs-head">
                <div><div class="rb-sheet-title" style="text-align:left">Правила маршрута</div>
                     <div class="rb-pcard-sub">Как прокладывать путь по тропам</div></div>
                <span class="rb-spacer"></span>
                ${prefsCustomized() ? '<button class="rb-reset" id="rb-prefs-reset">Сбросить</button>' : ''}
                <button class="rb-x" id="rb-prefs-close" aria-label="Закрыть">${ICONS.close}</button>
            </div>
            <div class="rb-prefs-body">
                ${card('🥾', 'Сложность троп', 'Маршруты сложнее выбранного уровня роутер не предложит вовсе',
                       `<div class="rb-levels">${levels}</div>`)}
                ${card('🧭', 'Держаться троп', 'Насколько неохотно роутер срезает по обычным дорогам вместо размеченных троп',
                       `<div class="rb-segs">${tp}</div>`)}
                ${card('🌲', 'Предпочтения', 'Не жёсткие запреты — роутер просто выбирает такой путь охотнее',
                       toggle('preferForest', 'Через лес', 'Тень и укрытие от ветра') +
                       toggle('preferWater', 'Вдоль воды', 'Реки, озёра — там, где они есть по дороге') +
                       toggle('avoidTowns', 'В обход городов', 'Меньше асфальта и застройки') +
                       toggle('avoidNoise', 'Потише', 'В обход шумных дорог') +
                       toggle('minimizeElevation', 'Меньше набора высоты', 'Роутер поищет более пологий путь') +
                       toggle('avoidMud', 'Избегать грязи', 'В обход заболоченных и мокрых участков'))}
                ${card('🪜', 'Можно проходить', 'Выключи, если хочешь путь без этого совсем',
                       toggle('allowSteps', 'Лестницы и ступени', 'Крутые участки, оборудованные ступенями') +
                       toggle('allowFerries', 'Паромы', 'Переправы, где пешей тропы нет вовсе'))}
                <p class="tw-note">Действует на новые отрезки — уже нарисованные остаются как были.</p>
            </div>`;

        const commit = () => { storePrefs(); renderPrefs(); render(); };
        box.querySelector('#rb-prefs-close').onclick = closePrefs;
        const resetBtn = box.querySelector('#rb-prefs-reset');
        if (resetBtn) resetBtn.onclick = () => { prefs = Object.assign({}, DEFAULT_PREFS); commit(); };
        box.querySelectorAll('[data-level]').forEach(b => {
            b.onclick = () => { prefs.maxDifficulty = Number(b.dataset.level); commit(); };
        });
        box.querySelectorAll('[data-tp]').forEach(b => {
            b.onclick = () => { prefs.trailPreference = Number(b.dataset.tp); commit(); };
        });
        box.querySelectorAll('.rb-switch').forEach(inp => {
            inp.onchange = () => { prefs[inp.dataset.key] = inp.checked; commit(); };
        });
    }

    // ── Вход и выход ────────────────────────────────────────────────────────

    let listenersOn = false;

    function start(opts) {
        if (active || !window.map) return;
        if (!map.getLayer('route-markers-layer')) {        // карта ещё не встала
            map.once('load', () => start(opts));
            return;
        }
        buildDOM();
        active = true;
        reset();
        document.body.classList.add('tw-drawing');

        // Открытый маршрут закрываем — без облёта к обзору: рисовать собираются
        // ровно там, куда смотрят (btn-back проверяет RouteBuilder.active)
        if (window.RouteProfile) RouteProfile.stopCinematic(true);
        if (typeof currentViewedRoute !== 'undefined' && currentViewedRoute) document.getElementById('btn-back').click();
        document.getElementById('mobile-info').classList.add('hidden');
        const layers = document.getElementById('layers-panel');
        if (layers) layers.classList.remove('open');
        if (window.Account) Account.closeModal();
        if (window.MapPoints) MapPoints.hideCard();

        // Нулевые отступы: они уводят центр камеры от середины экрана, и
        // точка «Шага» вставала бы не под прицел. Наклон, в отличие от
        // приложения, оставляем: `unproject` середины экрана и клик у Mapbox
        // GL JS садятся на рельеф при любой перспективе, а `project` для
        // «резинки» к краю не прижимает — считать Меркатор самим не нужно.
        const zero = { top: 0, bottom: 0, left: 0, right: 0 };
        if (!(opts && opts.keepCamera)) map.easeTo({ padding: zero, duration: 350 });
        else map.setPadding(zero);

        ensurePSSSegments();
        ensureLayers();
        if (!listenersOn) {
            map.on('click', onMapClick);
            map.on('move', updateAim);
            ['dragend', 'zoomend', 'rotateend', 'pitchend'].forEach(ev => map.on(ev, onGestureEnd));
            document.addEventListener('keydown', onKey);
            listenersOn = true;
        }
        map.getCanvas().style.cursor = 'crosshair';
        changed();
    }

    function stop(saved) {
        if (!active) return;
        active = false;
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        reset();
        closeSave();
        closePrefs();
        if (listenersOn) {
            map.off('click', onMapClick);
            map.off('move', updateAim);
            ['dragend', 'zoomend', 'rotateend', 'pitchend'].forEach(ev => map.off(ev, onGestureEnd));
            document.removeEventListener('keydown', onKey);
            listenersOn = false;
        }
        removeLayers();
        map.getCanvas().style.cursor = '';
        document.body.classList.remove('tw-drawing');
        updateAim();
    }

    function init() {
        const d = takeDraft();
        if (!d || !window.map) return;
        if (map.getLayer('route-markers-layer')) restoreDraft(d);
        else map.once('load', () => restoreDraft(d));
    }

    window.RouteBuilder = {
        get active() { return active; },
        start: () => start(),
        stop: () => stop()
    };

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
