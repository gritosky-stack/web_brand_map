/**
 * Остальные слои из «Слоёв» приложения: основа (топо, историческая карта),
 * тропы ПСС и OSM, крутизна склонов, железные дороги со станциями.
 * Вода, укрытия и пещеры — в map_points.js, хитмап — `toggleHeatmap` в script.js.
 *
 * Всё, что тянет тайлы или тяжёлый GeoJSON, добавляется **лениво**, по первому
 * включению: с `opacity=0` или `visibility: none` растр всё равно качался бы.
 *
 * ⚠️ Порядок. Растры и линии просятся в одно место — под маску вокруг Сербии
 * (`world-mask-layer`), и кто добавлен последним, тот и сверху: бумажная
 * подложка гравюры, включённая после хитмапа, просто стирала бы его. Поэтому
 * после каждого добавления стопка раскладывается заново по `STACK` (`restack`).
 * Всё это лежит под первым слоем подписей — одной пачкой, которую рельеф
 * натягивает разом (см. `drapeBeforeId` в script.js).
 */
(function () {
    'use strict';

    const R2 = 'https://pub-46dba1bca6754d2499a2a5aa9d5c879f.r2.dev';
    // Гравюра — тот же набор, что приложение тянет онлайн (`HistMapTiles`)
    const HISTMAP = { tiles: `${R2}/histmap/v2/{z}/{x}/{y}.jpg`, minzoom: 7, maxzoom: 13,
                      bounds: [18.83, 42.25, 22.84, 46.25] };
    // Крутизна — `slope-tiles` из бандла приложения, выложенные в R2
    // (`tools/tiles/upload_slope_r2.py`)
    const SLOPE_TILES = { tiles: `${R2}/slope/v1/{z}/{x}/{y}.png`, minzoom: 8, maxzoom: 11 };
    const SERBIA = [18.81, 41.85, 23.01, 46.19];

    const RAIL_INK = '#1F1C18';
    const PSS_ORANGE = '#FF8C1A';
    const OSM_GREEN = '#59D96B';

    /**
     * ⚠️ Ширина линии, зависящая от зума, дорого стоит на рельефе. Видимый
     * line-слой с таким `line-width` каждый кадр сбрасывает кэш «натянутой»
     * картинки **для всего своего источника**
     * (`_clearLineLayersFromRenderCache` в mapbox-gl), и пачка рисуется
     * заново по шестьдесят раз в секунду. У края гравюры это стоило половины
     * кадров: вместе с ним заново натягивался лист бумаги во весь экран —
     * 23 → 45 кадров в секунду от одной замены выражения на число (замер
     * 2026-09-20). Поэтому ширины здесь постоянные, а где линия должна
     * пропадать на обзоре — у слоя стоит `minzoom`.
     */
    // Снизу вверх. Всё — под маской мира
    const STACK = [
        'topo-layer',
        'histmap-backdrop', 'histmap-layer', 'histmap-edge',
        'slope-layer', 'heatmap-layer',
        'osm-trails', 'pss-trails-casing', 'pss-trails-glow', 'pss-trails-line',
        'railway-line', 'railway-hatch'
    ];

    const on = { topo: false, histmap: false, slope: false, pss: false, osm: false, rail: true };
    // Гравюра по умолчанию во всю силу: так под ней можно погасить основу
    // (см. syncBase) — вдвое меньше работы на кадр. Ползунок её проявляет
    let histAlpha = 1;
    // С какой плотности накладки основа под ней уже не видна
    const OPAQUE_FROM = 0.95;

    const map = () => window.map;
    /** Карта готова принимать наши слои (как в map_points.js) */
    const ready = () => !!(map() && map().getLayer('route-markers-layer'));

    function restack() {
        const m = map();
        if (!m || !m.getLayer('world-mask-layer')) return;
        for (const id of STACK) if (m.getLayer(id)) m.moveLayer(id, 'world-mask-layer');
    }

    function removeLayers(ids, sources) {
        const m = map();
        ids.forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
        sources.forEach(id => { if (m.getSource(id)) m.removeSource(id); });
    }

    function setVisibility(ids, visible) {
        const m = map();
        ids.forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); });
    }

    // ── Топооснова ──────────────────────────────────────────────────────────

    /**
     * OpenTopoMap поверх спутника, как `ensureTopoLayer` в приложении: там это
     * тоже растр над основой, а не смена стиля — стиль снёс бы все наши слои.
     * Три зеркала: сервер режет частые запросы с одного соединения.
     */
    function applyTopo() {
        const m = map();
        removeLayers(['topo-layer'], ['topo-source']);
        if (!on.topo) { syncBase(); return; }

        m.addSource('topo-source', {
            type: 'raster', tileSize: 256, minzoom: 5, maxzoom: 17, bounds: SERBIA,
            tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
            attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors'
        });
        m.addLayer({ id: 'topo-layer', type: 'raster', source: 'topo-source',
                     paint: { 'raster-fade-duration': 0 } }, 'world-mask-layer');
        syncBase();
        restack();
    }

    // ── Основа под непрозрачной накладкой ───────────────────────────────────

    let hiddenBase = [];
    const KEEPALIVE = 'composite-keepalive';

    /**
     * Спутник, дороги и подписи стиля под сплошной накладкой не видны, но
     * карта их честно рисует и натягивает на рельеф каждый кадр. Гасим их,
     * пока сверху лежит топооснова или гравюра во всю силу: на замере
     * вращение с топо шло 21.6 кадра в секунду, а без основы под ней — 49.9
     * (гравюра: 18.5 → 28.7). Свои слои и маску вокруг Сербии не трогаем.
     *
     * ⚠️ Источник `composite` при этом обязан остаться «используемым»: по
     * нему работают тропы конструктора (`harvestTrails`) и ближайший посёлок
     * в карточке точки. Mapbox перестаёт возить тайлы источника, у которого
     * не осталось ни одного видимого слоя, — поэтому вместо основы кладём
     * пустышку: слой с фильтром, под который не попадает ничего.
     */
    function syncBase() {
        const m = map();
        if (!m || !m.getStyle()) return;
        const opaque = on.topo || (on.histmap && histAlpha >= OPAQUE_FROM);
        if (opaque === !!hiddenBase.length) return;

        if (!opaque) {
            hiddenBase.forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible'); });
            hiddenBase = [];
            if (m.getLayer(KEEPALIVE)) m.removeLayer(KEEPALIVE);
            return;
        }
        for (const l of m.getStyle().layers) {
            // Слои стиля — это `composite` (векторные данные) и `mapbox`
            // (спутник). Всё наше лежит на своих источниках
            if (l.source !== 'composite' && l.source !== 'mapbox') continue;
            if (m.getLayoutProperty(l.id, 'visibility') === 'none') continue;
            m.setLayoutProperty(l.id, 'visibility', 'none');
            hiddenBase.push(l.id);
        }
        if (hiddenBase.length && !m.getLayer(KEEPALIVE)) {
            // Кружком, а не линией: линию рельеф натягивал бы пачкой и брал
            // за это отдельный проход, а круги на рельеф не натягиваются
            m.addLayer({ id: KEEPALIVE, type: 'circle', source: 'composite', 'source-layer': 'road',
                         filter: ['==', ['get', 'class'], '\u0000'],
                         paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
        }
    }

    // ── Историческая карта ──────────────────────────────────────────────────

    /** Клетка бумаги с еле заметной штриховкой — `paperPattern` приложения */
    function paperPattern() {
        const side = 24, c = document.createElement('canvas');
        c.width = c.height = side;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#F2EFE6';
        ctx.fillRect(0, 0, side, side);
        ctx.strokeStyle = 'rgba(163,156,144,.13)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Диагональ из угла в угол — только так плитка стыкуется без швов
        ctx.moveTo(0, side); ctx.lineTo(side, 0);
        ctx.moveTo(0, side / 2); ctx.lineTo(side / 2, 0);
        ctx.moveTo(side / 2, side); ctx.lineTo(side, side / 2);
        ctx.stroke();
        return ctx.getImageData(0, 0, side, side);
    }

    /**
     * Гравюра с бумажной подложкой и пунктиром по краю съёмки, как
     * `updateHistMap` в приложении. Подложка нужна, потому что «Спецкарты»
     * хватает не на всю Сербию: без неё покрытие обрывалось бы прямо на
     * спутник — выглядит как поломка. Прозрачность у всех трёх общая, и
     * ползунок проявляет современную карту равномерно.
     *
     * ⚠️ Тайлы идут из R2 в браузер, поэтому бакету нужен CORS на GET —
     * без него Mapbox GL JS картинку не примет. Приложению это не нужно.
     */
    // Лист бумаги под гравюрой и пунктир по краю съёмки — **один** источник:
    // см. `syncBase` о цене лишнего источника. Рамка с запасом вокруг всего,
    // что может попасть в кадр
    const PAPER_RING = [[13, 37], [29, 37], [29, 51], [13, 51], [13, 37]];
    const PAPER = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [PAPER_RING] } };
    let coverage = null;

    function frameData() {
        return { type: 'FeatureCollection', features: [PAPER].concat(coverage || []) };
    }

    function applyHistMap() {
        const m = map();
        removeLayers(['histmap-edge', 'histmap-layer', 'histmap-backdrop'],
                     ['histmap-source', 'histmap-frame-src']);
        if (!on.histmap) { syncBase(); return; }

        if (!m.hasImage('histmap-paper')) m.addImage('histmap-paper', paperPattern(), { pixelRatio: 2 });
        m.addSource('histmap-frame-src', { type: 'geojson', data: frameData() });
        m.addLayer({ id: 'histmap-backdrop', type: 'fill', source: 'histmap-frame-src',
                     filter: ['==', ['geometry-type'], 'Polygon'],
                     paint: { 'fill-pattern': 'histmap-paper', 'fill-opacity': histAlpha } }, 'world-mask-layer');

        m.addSource('histmap-source', {
            type: 'raster', tiles: [HISTMAP.tiles],
            // 512 px: та же детальность, что 256 на зум глубже, а тайлов
            // в кадре вчетверо меньше — растр под рельефом дешевле
            tileSize: 512, minzoom: HISTMAP.minzoom, maxzoom: HISTMAP.maxzoom, bounds: HISTMAP.bounds,
            attribution: 'Library of Congress · k.u.k. Militärgeographisches Institut'
        });
        m.addLayer({ id: 'histmap-layer', type: 'raster', source: 'histmap-source',
                     paint: { 'raster-opacity': histAlpha, 'raster-fade-duration': 0,
                              'raster-resampling': 'linear' } }, 'world-mask-layer');

        m.addLayer({ id: 'histmap-edge', type: 'line', source: 'histmap-frame-src',
                     filter: ['==', ['geometry-type'], 'LineString'],
                     paint: { 'line-color': 'rgba(92,72,46,.85)', 'line-dasharray': [5, 3],
                              'line-width': 1.8, 'line-opacity': histAlpha } }, 'world-mask-layer');
        if (!coverage) {
            fetch('histmap_coverage.geojson').then(r => r.json()).then(gj => {
                coverage = gj.features || [];
                const src = map().getSource('histmap-frame-src');
                if (src) src.setData(frameData());
            }).catch(() => { coverage = []; });
        }
        syncBase();
        restack();
    }

    /** Ползунок правит слои, а не пересобирает источник: иначе на каждом
     *  движении тайлы перезапрашивались бы заново */
    function setHistAlpha(a) {
        histAlpha = a;
        syncBase();
        const m = map();
        if (!m || !m.getLayer('histmap-layer')) return;
        m.setPaintProperty('histmap-layer', 'raster-opacity', a);
        m.setPaintProperty('histmap-backdrop', 'fill-opacity', a);
        m.setPaintProperty('histmap-edge', 'line-opacity', a);
    }

    // ── Крутизна склонов ────────────────────────────────────────────────────

    function applySlope() {
        const m = map();
        removeLayers(['slope-layer'], ['slope-source']);
        if (!on.slope) return;
        m.addSource('slope-source', {
            type: 'raster', tiles: [SLOPE_TILES.tiles], tileSize: 512,
            minzoom: SLOPE_TILES.minzoom, maxzoom: SLOPE_TILES.maxzoom, bounds: SERBIA,
            attribution: 'Copernicus GLO-30 DEM'
        });
        // Прозрачность заложена в сами тайлы; здесь ещё приглушаем, чтобы
        // на спутнике заливка не спорила с рельефом. Ниже z8 растр
        // растягивается в кляксы — там он бесполезен
        m.addLayer({ id: 'slope-layer', type: 'raster', source: 'slope-source', minzoom: SLOPE_TILES.minzoom,
                     paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
                   'world-mask-layer');
        restack();
    }

    // ── Тропы ПСС и OSM ─────────────────────────────────────────────────────

    const PSS_LAYERS = ['pss-trails-casing', 'pss-trails-glow', 'pss-trails-line'];

    function applyPSS() {
        const m = map();
        if (on.pss && !m.getSource('pss-trails-source')) {
            // Тот же облегчённый файл, что читает ассистент (pss_layer.js)
            m.addSource('pss-trails-source', { type: 'geojson', data: 'pss_routes_web.geojson' });
            const round = { 'line-join': 'round', 'line-cap': 'round' };
            // Обводка — только вблизи (на обзоре она сливала тропы в пятно).
            // Порог слоем, а не нулевой шириной на z9: выражение по зуму
            // здесь дорого — см. STACK
            m.addLayer({ id: 'pss-trails-casing', type: 'line', source: 'pss-trails-source', layout: round,
                         minzoom: 10,
                         paint: { 'line-color': 'rgba(0,0,0,.5)', 'line-opacity': 0.65, 'line-width': 5 } },
                       'world-mask-layer');
            // Свечение — только вблизи: размытие дорогое, а на обзоре страны
            // три сотни маршрутов в ореолах всё равно сливаются в кашу
            m.addLayer({ id: 'pss-trails-glow', type: 'line', source: 'pss-trails-source', layout: round,
                         minzoom: 11,
                         paint: { 'line-color': 'rgba(255,140,26,.28)', 'line-width': 8, 'line-blur': 3.5,
                                  'line-opacity': 0.9 } }, 'world-mask-layer');
            m.addLayer({ id: 'pss-trails-line', type: 'line', source: 'pss-trails-source', layout: round,
                         paint: { 'line-color': PSS_ORANGE, 'line-width': 2.2, 'line-opacity': 0.85 } },
                       'world-mask-layer');
            // Клик по тропе — её карточка, как у ассистента
            m.on('click', 'pss-trails-line', e => {
                if (window.RouteBuilder && RouteBuilder.active) return;
                const f = e.features && e.features[0];
                if (f && f.properties.slug && window.showPSSRoute) showPSSRoute(f.properties.slug);
            });
            m.on('mouseenter', 'pss-trails-line', () => {
                if (!(window.RouteBuilder && RouteBuilder.active)) m.getCanvas().style.cursor = 'pointer';
            });
            m.on('mouseleave', 'pss-trails-line', () => {
                m.getCanvas().style.cursor = window.RouteBuilder && RouteBuilder.active ? 'crosshair' : '';
            });
            restack();
        }
        setVisibility(PSS_LAYERS, on.pss);
    }

    /**
     * Тропы OSM — из тайлов самого стиля (`composite/road`, классы path и
     * track), как `osm-hiking-trails` в приложении. В стиле они спрятаны
     * (`applyMapStyle`), здесь показываем своим цветом.
     * ⚠️ В тайлах Mapbox Streets тропы есть только с z13 — ниже слой пуст.
     */
    function applyOSM() {
        const m = map();
        if (on.osm && !m.getLayer('osm-trails')) {
            m.addLayer({
                id: 'osm-trails', type: 'line', source: 'composite', 'source-layer': 'road', minzoom: 8,
                filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': OSM_GREEN, 'line-width': 1.8, 'line-opacity': 0.9 }
            }, 'world-mask-layer');
            restack();
        }
        setVisibility(['osm-trails'], on.osm);
    }

    // ── Железные дороги и станции ───────────────────────────────────────────

    /**
     * Табличка станции — растягиваемая картинка под текст (`icon-text-fit`).
     * В приложении флажки рисует SwiftUI и сам раскладывает их без наложений;
     * здесь то же делает движок подписей — и заодно вытесняет чужие подписи
     * из-под таблички, для чего в приложении держат невидимый `station-reserve`.
     */
    function stationPlate() {
        const r = 2, w = 24 * r, h = 20 * r, rad = 5 * r;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(31,28,24,.94)';
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = r;
        // Руками, а не `roundRect`: его нет в Safari до 16-й версии
        const x0 = r / 2, y0 = r / 2, x1 = w - r / 2, y1 = h - r / 2;
        ctx.beginPath();
        ctx.moveTo(x0 + rad, y0);
        ctx.arcTo(x1, y0, x1, y1, rad); ctx.arcTo(x1, y1, x0, y1, rad);
        ctx.arcTo(x0, y1, x0, y0, rad); ctx.arcTo(x0, y0, x1, y0, rad);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        return { image: ctx.getImageData(0, 0, w, h),
                 options: { pixelRatio: r, stretchX: [[rad + r, w - rad - r]], stretchY: [[rad + r, h - rad - r]],
                            content: [rad, r * 2, w - rad, h - r * 2] } };
    }

    const RAIL_LAYERS = ['railway-line', 'railway-hatch', 'station-dot', 'station-label'];

    function applyRail() {
        const m = map();
        if (on.rail && !m.getSource('railways-src')) {
            m.addSource('railways-src', { type: 'geojson', data: 'railways.geojson' });
            const lines = ['==', ['get', 'kind'], 'rail'];
            const stations = ['==', ['get', 'kind'], 'station'];
            m.addLayer({ id: 'railway-line', type: 'line', source: 'railways-src', filter: lines,
                         layout: { 'line-join': 'round' },
                         paint: { 'line-color': RAIL_INK,
                                  'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 10, 3, 14, 5.5, 17, 9] } },
                       'world-mask-layer');
            // Белые засечки поверх — «лесенка», по которой железную дорогу и узнают
            m.addLayer({ id: 'railway-hatch', type: 'line', source: 'railways-src', filter: lines, minzoom: 8,
                         paint: { 'line-color': '#ffffff', 'line-dasharray': [0.55, 1.4],
                                  'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3.4, 17, 5.6] } },
                       'world-mask-layer');

            // Станции — поверх всего нашего, но под метками маршрутов
            const before = m.getLayer('route-markers-layer') ? 'route-markers-layer' : undefined;
            const major = ['==', ['get', 'major'], true];
            m.addLayer({ id: 'station-dot', type: 'circle', source: 'railways-src', filter: stations, minzoom: 8.5,
                         paint: { 'circle-radius': ['case', major, 5.5, 4], 'circle-color': RAIL_INK,
                                  'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
                                  'circle-pitch-alignment': 'map' } }, before);
            if (!m.hasImage('station-plate')) {
                const plate = stationPlate();
                m.addImage('station-plate', plate.image, plate.options);
            }
            m.addLayer({
                id: 'station-label', type: 'symbol', source: 'railways-src', filter: stations, minzoom: 8.5,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                    'text-size': ['case', major, 12, 10.5],
                    'text-anchor': 'bottom', 'text-offset': [0, -0.9],
                    'icon-image': 'station-plate', 'icon-text-fit': 'both',
                    'icon-text-fit-padding': [2, 6, 2, 6],
                    // Вокзалы вперёд: при тесноте остаются они, а не полустанки
                    'symbol-sort-key': ['case', major, 0, 1],
                    'text-padding': 4
                },
                paint: { 'text-color': '#ffffff' }
            }, before);
            restack();
        }
        setVisibility(RAIL_LAYERS, on.rail);
    }

    // ── Тумблеры ────────────────────────────────────────────────────────────

    const APPLY = { topo: applyTopo, histmap: applyHistMap, slope: applySlope,
                    pss: applyPSS, osm: applyOSM, rail: applyRail };

    function set(key, value) {
        on[key] = value;
        if (key === 'rail') { try { localStorage.setItem('tw-layer-rail', value ? '1' : '0'); } catch (e) {} }
        if (ready()) APPLY[key]();
        if (window.syncLayersBtn) syncLayersBtn();
    }

    /** Что-то включено сверх обычного вида — подсветить кнопку «Слои» */
    function anyOn() {
        return on.topo || on.histmap || on.slope || on.pss || on.osm;
    }

    function syncHistRow() {
        const row = document.getElementById('histmap-alpha-row');
        if (row) row.classList.toggle('hidden', !on.histmap);
        const lock = document.getElementById('layer-histmap-lock');
        if (lock) lock.classList.toggle('hidden', !!(window.Premium && Premium.allowed()));
    }

    function init() {
        try { on.rail = localStorage.getItem('tw-layer-rail') !== '0'; } catch (e) {}

        const bind = (inputId, key, guard) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.checked = on[key];
            input.addEventListener('change', () => {
                if (input.checked && guard && !guard()) { input.checked = false; return; }
                set(key, input.checked);
                if (key === 'histmap') syncHistRow();
            });
        };
        bind('layer-topo', 'topo');
        bind('layer-histmap', 'histmap', () => !window.Premium || Premium.require('histmap'));
        bind('layer-slope', 'slope');
        bind('layer-pss', 'pss');
        bind('layer-osm', 'osm');
        bind('layer-rail', 'rail');

        const alpha = document.getElementById('histmap-alpha');
        const alphaValue = document.getElementById('histmap-alpha-value');
        if (alpha) {
            alpha.value = Math.round(histAlpha * 100);
            alphaValue.textContent = `${alpha.value}%`;
            alpha.addEventListener('input', () => {
                alphaValue.textContent = `${alpha.value}%`;
                setHistAlpha(alpha.value / 100);
            });
        }

        // Вышел или вошёл не тот — закрытый слой гасим
        document.addEventListener('tw-account', () => {
            syncHistRow();
            if (on.histmap && window.Premium && !Premium.allowed()) {
                const input = document.getElementById('layer-histmap');
                if (input) input.checked = false;
                set('histmap', false);
                syncHistRow();
            }
        });
        syncHistRow();

        // Включили до готовности карты — доставим слои, когда она встанет
        if (map()) map().on('load', () => {
            for (const key of Object.keys(on)) if (on[key]) APPLY[key]();
        });
    }

    window.ExtraLayers = { set, restack, anyOn, isOn: key => !!on[key] };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
