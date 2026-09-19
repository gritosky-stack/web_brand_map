/**
 * Вода и укрытия — точечные слои из OpenStreetMap, как в приложении
 * (`Models/MapPoint.swift`, `loadMapPointLayers` в `MapboxMapView.swift`,
 * карточка `Views/MapPointBar.swift`).
 *
 * Данные — те же файлы, что в бандле приложения (`hikingmap/hikingmap/Data/
 * water.geojson` и `shelters.geojson`, собирает `tools/tiles/fetch_poi.py`),
 * копией в `www/`. Включаются раздельно в «Слоях»: воду ищут по ходу дня,
 * крышу — при планировании ночёвки.
 *
 * Слои добавляются **лениво**, по первому включению: полтора мегабайта
 * точек незачем качать тем, кто их не включит. Дальше — только видимость.
 */
(function () {
    'use strict';

    const KINDS = {
        spring:  { emoji: '💧', title: 'Родник' },
        well:    { emoji: '🪣', title: 'Колодец' },
        tap:     { emoji: '🚰', title: 'Колонка' },
        hut:     { emoji: '🏠', title: 'Дом' },
        shelter: { emoji: '⛺️', title: 'Навес' },
        camp:    { emoji: '🏕', title: 'Кемпинг' }
    };

    // Цвет кластеров — чтобы вода и крыша различались и на спутнике
    const SETS = {
        water:   { file: 'water.geojson',    kinds: ['spring', 'well', 'tap'],     cluster: 'rgba(41,140,217,.72)' },
        shelter: { file: 'shelters.geojson', kinds: ['hut', 'shelter', 'camp'],    cluster: 'rgba(158,102,41,.72)' }
    };

    const on = { water: false, shelter: false };

    // Свечение выделенной точки — цвет её набора, но ярче кластера
    const GLOW = { water: '#4FB3FF', shelter: '#FFB347' };
    const setOf = kind => (SETS.water.kinds.includes(kind) ? 'water' : 'shelter');

    const ids = set => ({
        src: `${set}-poi-src`,
        bg: `${set}-poi-cluster-bg`,
        count: `${set}-poi-cluster-count`,
        sym: `${set}-poi-layer`
    });

    /** Значок: эмодзи на тёмном кружке с тенью — `makeEmojiPin` приложения. */
    function emojiPin(emoji, size) {
        const ratio = 2, px = size * ratio;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext('2d');
        const c = px / 2, r = px * 0.30;
        ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 8 * ratio; ctx.shadowOffsetY = 2 * ratio;
        ctx.fillStyle = 'rgba(26,26,26,.85)';
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.font = `${Math.round(px * 0.38)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(emoji, c, c + px * 0.02);
        return { image: ctx.getImageData(0, 0, px, px), ratio };
    }

    // Русское имя предпочтительнее сербского, сербское — латинского
    const NAME = ['coalesce', ['get', 'nameRu'], ['get', 'name'], ['get', 'nameSr'], ''];

    function ensureLayers(set) {
        const map = window.map;
        const id = ids(set);
        if (map.getSource(id.src)) return;
        const cfg = SETS[set];

        for (const kind of cfg.kinds) {
            const name = 'poi-' + kind;
            if (!map.hasImage(name)) {
                const pin = emojiPin(KINDS[kind].emoji, 34);
                map.addImage(name, pin.image, { pixelRatio: pin.ratio });
            }
        }

        map.addSource(id.src, {
            type: 'geojson', data: cfg.file,
            // Колонки в городах стоят плотно — без кластеров до крупного зума
            // карта превратилась бы в кашу из значков
            cluster: true, clusterRadius: 55, clusterMaxZoom: 13,
            attribution: '© OpenStreetMap contributors'
        });

        // Под пульсирующими точками маршрутов: наши маршруты важнее
        const before = map.getLayer('route-markers-layer') ? 'route-markers-layer' : undefined;
        map.addLayer({
            id: id.bg, type: 'circle', source: id.src, filter: ['has', 'point_count'],
            paint: {
                'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 50, 18, 200, 22],
                'circle-color': cfg.cluster,
                'circle-stroke-width': 1.5, 'circle-stroke-color': 'rgba(255,255,255,.55)'
            }
        }, before);
        map.addLayer({
            id: id.count, type: 'symbol', source: id.src, filter: ['has', 'point_count'],
            layout: {
                'text-field': ['get', 'point_count_abbreviated'], 'text-size': 10,
                'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true
            },
            paint: { 'text-color': '#ffffff' }
        }, before);
        // Подпись — только вблизи, значок — всегда: в сельской местности точки
        // редкие, в кластер не собираются, и `minzoom` на слой прятал бы их
        map.addLayer({
            id: id.sym, type: 'symbol', source: id.src, filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': ['concat', 'poi-', ['get', 'kind']],
                'icon-allow-overlap': false,
                'text-field': ['step', ['zoom'], '', 13, NAME],
                'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true
            },
            paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.2 }
        }, before);

        for (const layer of [id.bg, id.sym]) {
            map.on('click', layer, onClick);
            map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layer, () => {
                map.getCanvas().style.cursor = window.RouteBuilder && RouteBuilder.active ? 'crosshair' : '';
            });
        }
    }

    function setVisible(set, visible) {
        on[set] = visible;
        const map = window.map;
        if (!map || !map.getLayer('route-markers-layer')) return;   // включим по load
        if (visible) ensureLayers(set);
        const id = ids(set);
        for (const l of [id.bg, id.count, id.sym]) {
            if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none');
        }
        if (!visible && current && SETS[set].kinds.includes(current.kind)) hideCard();
    }

    // ── Нажатие ─────────────────────────────────────────────────────────────

    let lastClickAt = 0;
    function onClick(e) {
        // Пока рисуют маршрут, клик ставит точку — не перехватываем
        if (window.RouteBuilder && RouteBuilder.active) return;
        // Кластер и точка под одним кликом приходят двумя событиями
        if (performance.now() - lastClickAt < 50) return;
        lastClickAt = performance.now();
        const f = e.features && e.features[0];
        if (!f) return;
        const map = window.map;
        if (f.properties.point_count != null) {
            map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2.5, duration: 550 });
            return;
        }
        showCard(f.properties, f.geometry.coordinates);
    }

    // ── Карточка (MapPointBar) ──────────────────────────────────────────────

    let current = null;

    /**
     * Выделенная точка — её же значок, крупнее и со свечением, поверх
     * остальных. Отдельный маркер-кружок читался как «ещё одна точка», а
     * DOM-метка на рельефе к тому же съезжала со значка. Свой источник на
     * одну точку: у кластеризованного источника строковые id из OSM не
     * доживают до карты, и выделить точку в нём самом нечем.
     */
    function ensureSelectedLayers() {
        const map = window.map;
        if (map.getSource('poi-selected')) return;
        map.addSource('poi-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'poi-selected-glow', type: 'circle', source: 'poi-selected',
            paint: {
                'circle-radius': 30, 'circle-blur': 0.55, 'circle-opacity': 1,
                'circle-color': ['match', ['get', 'set'], 'water', GLOW.water, GLOW.shelter],
                'circle-pitch-alignment': 'viewport'
            }
        });
        map.addLayer({
            id: 'poi-selected-ring', type: 'circle', source: 'poi-selected',
            paint: {
                'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)',
                'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
                'circle-pitch-alignment': 'viewport'
            }
        });
        map.addLayer({
            id: 'poi-selected-icon', type: 'symbol', source: 'poi-selected',
            layout: {
                'icon-image': ['concat', 'poi-', ['get', 'kind']], 'icon-size': 1.55,
                'icon-allow-overlap': true, 'icon-ignore-placement': true
            }
        });
    }

    function setSelected(p, coords) {
        const map = window.map;
        ensureSelectedLayers();
        map.getSource('poi-selected').setData({
            type: 'FeatureCollection',
            features: p ? [{ type: 'Feature', properties: { kind: p.kind, set: setOf(p.kind) },
                             geometry: { type: 'Point', coordinates: coords } }] : []
        });
        // Выше всего, что добавили после нас (линия маршрута, метки)
        ['poi-selected-glow', 'poi-selected-ring', 'poi-selected-icon'].forEach(l => map.moveLayer(l));
    }

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /** В OSM высота бывает и числом, и строкой вида «1032 m». */
    function number(v) {
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v == null ? '' : v).replace('m', '').trim());
        return isFinite(n) ? n : null;
    }

    /** Приписка под названием — только то, что источник знает. */
    function subtitle(p) {
        // Без названия заголовком уже стоит вид точки — не повторяем его
        const named = !!(p.nameRu || p.name || p.nameSr);
        const parts = named ? [KINDS[p.kind].title] : [];
        // Mapbox отдаёт свойства кластеризованного источника как есть, но
        // булевы из GeoJSON иногда приходят строкой
        const yes = v => v === true || v === 'true', no = v => v === false || v === 'false';
        if (yes(p.drinking)) parts.push('питьевая');
        if (no(p.drinking)) parts.push('не питьевая');
        if (yes(p.seasonal)) parts.push('пересыхает');
        if (yes(p.fee)) parts.push('платно');
        const ele = number(p.ele);
        if (ele != null) parts.push(`${Math.round(ele)} м`);
        return parts.join(' · ') || 'OpenStreetMap';
    }

    function showCard(p, coords) {
        if (!KINDS[p.kind]) return;
        current = p;
        let el = document.getElementById('poi-card');
        if (!el) {
            el = document.createElement('div');
            el.id = 'poi-card';
            document.body.appendChild(el);
        }
        const title = p.nameRu || p.name || p.nameSr || KINDS[p.kind].title;
        const drinkNo = p.drinking === false || p.drinking === 'false';
        const seasonal = p.seasonal === true || p.seasonal === 'true';
        // Предупреждение — только там, где источник прямо сказал «пересыхает»
        // или «пить нельзя». Молчание OSM за факт не выдаём.
        const warn = drinkNo ? 'Пить нельзя — так указано в OSM'
            : seasonal ? 'Летом может пересохнуть' : '';
        el.innerHTML = `
            <div class="poi-emoji">${KINDS[p.kind].emoji}</div>
            <div class="poi-text">
                <div class="poi-title">${esc(title)}</div>
                <div class="poi-sub">${esc(subtitle(p))}</div>
                ${warn ? `<div class="poi-warn">${warn}</div>` : ''}
            </div>
            <button class="poi-close" aria-label="Закрыть">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>`;
        el.querySelector('.poi-close').onclick = hideCard;
        el.classList.add('open');

        setSelected(p, coords);
    }

    function hideCard() {
        current = null;
        const el = document.getElementById('poi-card');
        if (el) el.classList.remove('open');
        if (window.map && map.getSource('poi-selected')) setSelected(null);
    }

    // ── Тумблеры в «Слоях» ──────────────────────────────────────────────────

    function init() {
        const bind = (inputId, set) => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.addEventListener('change', () => setVisible(set, input.checked));
        };
        bind('layer-water', 'water');
        bind('layer-shelter', 'shelter');
        // Включили до готовности карты — доставим слои, когда она встанет
        if (window.map) window.map.on('load', () => {
            for (const set of Object.keys(on)) if (on[set]) setVisible(set, true);
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });
        // Клик по карте мимо точек снимает выделение — как тап мимо в
        // приложении. Клик по самой плашке до карты не доходит.
        if (window.map) window.map.on('click', e => {
            if (!current) return;
            const layers = ['water-poi-layer', 'water-poi-cluster-bg', 'shelter-poi-layer',
                            'shelter-poi-cluster-bg', 'poi-selected-icon'].filter(l => window.map.getLayer(l));
            const hit = layers.length && window.map.queryRenderedFeatures(e.point, { layers }).length;
            if (!hit) hideCard();
        });
    }

    window.MapPoints = { setVisible, hideCard };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
