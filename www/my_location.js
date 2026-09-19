/**
 * «Моя локация» — как `MyLocationButton` приложения: синяя точка с кругом
 * точности и перелёт к себе. В походе с телефона это главное — где я на тропе.
 *
 * Кнопка в три состояния:
 *   выкл. → ищем и следим (`watchPosition`), камера летит к точке;
 *   вкл., но карту увели → вернуть камеру к точке;
 *   вкл. и точка в центре → выключить.
 *
 * Точка — слой карты, а не DOM-метка: на наклонённом рельефе DOM-метка
 * висела бы в стороне от места (как старт и финиш, см. route_marks.js).
 */
(function () {
    'use strict';

    const BLUE = '#2F80ED';
    // Рамка карты (`maxBounds` в script.js): за ней камера всё равно не встанет
    const REGION = { w: 17.2, s: 41.0, e: 24.4, n: 47.4 };

    let watchId = null;
    let fix = null;             // { lon, lat, accuracy }
    let waitingFirst = false;

    const btn = () => document.getElementById('btn-my-location');
    const toast = t => window.MyRoutes && MyRoutes.toast(t);

    function setState(state) {
        const b = btn();
        if (!b) return;
        b.classList.toggle('locating', state === 'locating');
        b.classList.toggle('active', state === 'on');
    }

    function ensureLayers() {
        const m = window.map;
        if (m.getSource('my-location')) return;
        m.addSource('my-location', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'my-location-accuracy', type: 'circle', source: 'my-location',
                     paint: { 'circle-color': BLUE, 'circle-opacity': 0.14, 'circle-stroke-width': 1,
                              'circle-stroke-color': 'rgba(47,128,237,.45)', 'circle-pitch-alignment': 'map',
                              'circle-radius': 0 } });
        m.addLayer({ id: 'my-location-dot', type: 'circle', source: 'my-location',
                     paint: { 'circle-color': BLUE, 'circle-radius': 7, 'circle-stroke-width': 3,
                              'circle-stroke-color': '#ffffff', 'circle-pitch-alignment': 'map' } });
    }

    function draw() {
        const m = window.map;
        if (!m || !m.getLayer('route-markers-layer')) return;
        ensureLayers();
        m.getSource('my-location').setData({ type: 'FeatureCollection', features: fix
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] } }] : [] });
        if (!fix) return;
        // Радиус круга — в метрах, а `circle-radius` — в пикселях: пересчёт по
        // зуму, пиксель на экваторе делится на cos широты и удваивается на зум
        const mpp0 = 156543.03 * Math.cos(fix.lat * Math.PI / 180);
        const r = Math.min(fix.accuracy, 5000);
        m.setPaintProperty('my-location-accuracy', 'circle-radius',
            ['interpolate', ['exponential', 2], ['zoom'], 0, r / mpp0, 22, r / mpp0 * 2 ** 22]);
        m.moveLayer('my-location-accuracy');
        m.moveLayer('my-location-dot');
    }

    const inRegion = f => f.lon >= REGION.w && f.lon <= REGION.e && f.lat >= REGION.s && f.lat <= REGION.n;

    function center() {
        if (!fix || !window.map) return;
        if (!inRegion(fix)) { toast('Вы за пределами карты — она только по Сербии'); return; }
        map.flyTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 14), speed: 1.3, essential: true });
    }

    function isCentered() {
        if (!fix || !window.map) return false;
        const p = map.project([fix.lon, fix.lat]);
        const c = map.getCanvas();
        return Math.hypot(p.x - c.clientWidth / 2, p.y - c.clientHeight / 2) < 40;
    }

    function start() {
        if (!('geolocation' in navigator)) { toast('Браузер не умеет определять место'); return; }
        setState('locating');
        waitingFirst = true;
        watchId = navigator.geolocation.watchPosition(pos => {
            fix = { lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy || 30 };
            setState('on');
            draw();
            if (waitingFirst) { waitingFirst = false; center(); }
        }, err => {
            // Отказ — это ответ насовсем; остальное (нет сигнала) переживём
            if (err.code === err.PERMISSION_DENIED) {
                toast('Доступ к геопозиции запрещён — разрешите его в настройках браузера');
                stop();
            } else if (waitingFirst) {
                toast('Не получается определить место — попробуйте на открытом месте');
                stop();
            }
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }

    function stop() {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        fix = null;
        waitingFirst = false;
        setState('off');
        draw();
    }

    function onPress() {
        if (watchId == null) start();
        else if (!fix) stop();          // ещё ищем, а нажали снова — передумали
        else if (isCentered()) stop();
        else center();
    }

    function init() {
        const b = btn();
        if (b) b.addEventListener('click', onPress);
    }

    window.MyLocation = { start, stop, get fix() { return fix; } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
