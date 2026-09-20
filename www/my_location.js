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
 *
 * Куда смотришь — конус от точки, как `puckBearing = .heading` в приложении
 * (`MapboxMapView+MyLocation.swift`). Конус лежит **на земле**
 * (`icon-rotation-alignment: 'map'`), поэтому он верен при любом повороте и
 * наклоне камеры, а не только на плоской карте.
 */
(function () {
    'use strict';

    const BLUE = '#2F80ED';
    // Рамка карты (`maxBounds` в script.js): за ней камера всё равно не встанет
    const REGION = { w: 17.2, s: 41.0, e: 24.4, n: 47.4 };

    let watchId = null;
    let fix = null;             // { lon, lat, accuracy }
    let waitingFirst = false;
    let heading = null;         // градусы от севера по часовой, null — компаса нет
    let headingOn = false;
    let lastHeadingDraw = 0;

    const btn = () => document.getElementById('btn-my-location');
    const toast = t => window.MyRoutes && MyRoutes.toast(t);

    function setState(state) {
        const b = btn();
        if (!b) return;
        b.classList.toggle('locating', state === 'locating');
        b.classList.toggle('active', state === 'on');
    }

    /**
     * Конус направления: вершина в точке, к краю растворяется. Рисуем в
     * картинку, а не слоем-полигоном, — полигон пришлось бы пересобирать в
     * метрах на каждый градус поворота.
     */
    function headingImage() {
        const size = 60, r = 2, px = size * r;
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const ctx = c.getContext('2d');
        const apexX = px / 2, apexY = px;          // вершина — низ картинки
        const reach = px * 0.95, half = 25 * Math.PI / 180;
        // ⚠️ Плотность у вершины почти полная. Первая версия шла от 0.7 к нулю
        // и на спутниковом снимке пропадала совсем: синий полупрозрачный
        // клин на пёстрой зелени глазом не ловится
        const grad = ctx.createRadialGradient(apexX, apexY, px * 0.06, apexX, apexY, reach);
        grad.addColorStop(0, 'rgba(47,128,237,.95)');
        grad.addColorStop(0.45, 'rgba(47,128,237,.55)');
        grad.addColorStop(1, 'rgba(47,128,237,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(apexX, apexY);
        // Дуга «вверх» — от -90° на пол-угла в обе стороны
        ctx.arc(apexX, apexY, reach, -Math.PI / 2 - half, -Math.PI / 2 + half);
        ctx.closePath();
        ctx.fill();
        return { image: ctx.getImageData(0, 0, px, px), pixelRatio: r };
    }

    function ensureLayers() {
        const m = window.map;
        if (m.getSource('my-location')) return;
        m.addSource('my-location', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'my-location-accuracy', type: 'circle', source: 'my-location',
                     paint: { 'circle-color': BLUE, 'circle-opacity': 0.14, 'circle-stroke-width': 1,
                              'circle-stroke-color': 'rgba(47,128,237,.45)', 'circle-pitch-alignment': 'map',
                              'circle-radius': 0 } });
        if (!m.hasImage('my-location-cone')) {
            const cone = headingImage();
            m.addImage('my-location-cone', cone.image, { pixelRatio: cone.pixelRatio });
        }
        // ⚠️ Конус лежит на земле и поворачивается вместе с картой
        // (`rotation-alignment: 'map'`): иначе при повороте камеры он показывал
        // бы не туда, куда человек смотрит, а куда смотрит экран.
        m.addLayer({ id: 'my-location-heading', type: 'symbol', source: 'my-location',
                     filter: ['has', 'heading'],
                     layout: { 'icon-image': 'my-location-cone', 'icon-anchor': 'bottom',
                               'icon-rotate': ['get', 'heading'],
                               'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
                               'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        m.addLayer({ id: 'my-location-dot', type: 'circle', source: 'my-location',
                     paint: { 'circle-color': BLUE, 'circle-radius': 7, 'circle-stroke-width': 3,
                              'circle-stroke-color': '#ffffff', 'circle-pitch-alignment': 'map' } });
    }

    /** Только данные точки: компас шлёт события десятками в секунду. */
    function updateSource() {
        const m = window.map;
        const src = m && m.getSource && m.getSource('my-location');
        if (!src) return;
        const props = heading == null ? {} : { heading: Math.round(heading * 10) / 10 };
        src.setData({ type: 'FeatureCollection', features: fix
            ? [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] } }] : [] });
    }

    function draw() {
        const m = window.map;
        if (!m || !m.getLayer('route-markers-layer')) return;
        ensureLayers();
        updateSource();
        if (!fix) return;
        // Радиус круга — в метрах, а `circle-radius` — в пикселях: пересчёт по
        // зуму, пиксель на экваторе делится на cos широты и удваивается на зум
        const mpp0 = 156543.03 * Math.cos(fix.lat * Math.PI / 180);
        const r = Math.min(fix.accuracy, 5000);
        m.setPaintProperty('my-location-accuracy', 'circle-radius',
            ['interpolate', ['exponential', 2], ['zoom'], 0, r / mpp0, 22, r / mpp0 * 2 ** 22]);
        m.moveLayer('my-location-accuracy');
        m.moveLayer('my-location-heading');
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

    // ── Компас ──────────────────────────────────────────────────────────────
    //
    // Соглашение то же, что у самого Mapbox GL JS в `GeolocateControl`: на iOS
    // берём `webkitCompassHeading` (он уже отсчитан от севера по часовой), в
    // остальных браузерах — `alpha` **только** у абсолютной ориентации, со
    // сменой знака. Не абсолютная ориентация отсчитывается от случайного
    // нуля, и конус показывал бы в произвольную сторону.
    //
    // ⚠️ На iOS доступ к датчику спрашивают из **жеста**: поэтому запрос идёт
    // из обработчика нажатия на кнопку, а не при загрузке страницы.

    function onOrientation(e) {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
        else if (e.absolute === true && typeof e.alpha === 'number') h = -e.alpha;
        if (h == null || !isFinite(h)) return;
        h = (h % 360 + 360) % 360;
        // Порог и частота: датчик шлёт под шестьдесят событий в секунду, а
        // перезаливать источник карты с такой частотой не за чем
        const delta = heading == null ? 360 : Math.abs(((h - heading + 540) % 360) - 180);
        const now = performance.now();
        if (delta < 2 || now - lastHeadingDraw < 120) { heading = h; return; }
        heading = h;
        lastHeadingDraw = now;
        updateSource();
    }

    function startHeading() {
        if (headingOn || typeof window.DeviceOrientationEvent === 'undefined') return;
        const listen = () => {
            headingOn = true;
            if ('ondeviceorientationabsolute' in window) {
                window.addEventListener('deviceorientationabsolute', onOrientation);
            } else {
                window.addEventListener('deviceorientation', onOrientation);
            }
        };
        const ask = DeviceOrientationEvent.requestPermission;
        if (typeof ask === 'function') {
            // Отказ — не беда: точка работает и без конуса
            ask.call(DeviceOrientationEvent).then(r => { if (r === 'granted') listen(); }, () => {});
        } else {
            listen();
        }
    }

    function stopHeading() {
        if (!headingOn) return;
        window.removeEventListener('deviceorientationabsolute', onOrientation);
        window.removeEventListener('deviceorientation', onOrientation);
        headingOn = false;
        heading = null;
    }

    function start() {
        if (!('geolocation' in navigator)) { toast('Браузер не умеет определять место'); return; }
        startHeading();
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
        stopHeading();
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

    window.MyLocation = { start, stop, get fix() { return fix; }, get heading() { return heading; } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
