/**
 * «Где сделано фото» — ручная привязка фотографии к точке маршрута.
 *
 * У снимка с телефона GPS в EXIF обычно есть, и тогда фото встаёт на тропу
 * само (`user_photos.js` читает координаты до пережатия). Но его может не
 * быть: снято на камеру без GPS, переслано мессенджером (те вырезают EXIF),
 * сделано в режиме без геометок. Такое фото оставалось без места на карте
 * навсегда — этот режим позволяет поставить точку пальцем.
 *
 * Как это работает: внизу лента фотографий без места, сверху подсказка, и
 * клик по карте ставит точку. Точка **притягивается к линии маршрута** (до
 * 200 м): фото сделано на тропе, а попасть пальцем точно в неё на обзорном
 * зуме невозможно. Дальше 200 м притяжения нет — со смотровой площадки в
 * стороне от тропы тоже фотографируют.
 *
 * Зависит от script.js (`map`, `parsedRouteDataCache`, `currentViewedRoute`,
 * `renderPhotoMapMarkers`) и route_status.js (`photosFor`, `setPhotoCoords`).
 */
(function () {
    'use strict';

    const SNAP_M = 200;          // ближе этого — садимся на линию маршрута
    const SRC = 'photo-place-src';

    let active = null;           // { routeInfo, photos, idx, coords }
    let onClick = null;

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function toast(t) { if (window.MyRoutes) MyRoutes.toast(t); }

    // ── Геометрия ───────────────────────────────────────────────────────────

    function metersBetween(a, b) {
        const R = 6371000, rad = Math.PI / 180;
        const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
        const h = Math.sin(dLat / 2) ** 2 +
                  Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    /**
     * Ближайшая точка **на** линии маршрута, а не ближайшая вершина: между
     * вершинами записанного трека бывает под тридцать метров, и по вершинам
     * точка заметно скакала бы вдоль тропы.
     */
    function snapToRoute(lngLat, coords) {
        if (!coords || coords.length < 2) return { coords: lngLat, dist: Infinity };
        // Плоское приближение: на масштабе маршрута ошибка меркатора мала,
        // а считать надо по нескольким тысячам отрезков на каждый клик
        const kx = Math.cos(lngLat[1] * Math.PI / 180);
        let best = null, bestD2 = Infinity;
        for (let i = 1; i < coords.length; i++) {
            const ax = (coords[i - 1][0] - lngLat[0]) * kx, ay = coords[i - 1][1] - lngLat[1];
            const bx = (coords[i][0] - lngLat[0]) * kx,     by = coords[i][1] - lngLat[1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = ax + t * dx, py = ay + t * dy;
            const d2 = px * px + py * py;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]),
                        coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])];
            }
        }
        return { coords: best || lngLat, dist: metersBetween(lngLat, best || lngLat) };
    }

    // ── Слой точки ──────────────────────────────────────────────────────────

    function ensureLayer() {
        if (!window.map || map.getSource(SRC)) return;
        map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'photo-place-halo', type: 'circle', source: SRC,
            paint: { 'circle-radius': 16, 'circle-color': '#FF8C00', 'circle-opacity': 0.22,
                     'circle-blur': 0.5 }
        });
        map.addLayer({
            id: 'photo-place-dot', type: 'circle', source: SRC,
            paint: { 'circle-radius': 7, 'circle-color': '#FF8C00',
                     'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' }
        });
    }

    function paintDot(coords) {
        if (!map.getSource(SRC)) return;
        map.getSource(SRC).setData({
            type: 'FeatureCollection',
            features: coords ? [{ type: 'Feature', properties: {},
                                  geometry: { type: 'Point', coordinates: coords } }] : []
        });
    }

    function clearLayer() {
        if (!window.map || !map.getStyle) return;
        ['photo-place-dot', 'photo-place-halo'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource(SRC)) map.removeSource(SRC);
    }

    // ── Плашка ──────────────────────────────────────────────────────────────

    function bar() { return document.getElementById('photo-place-bar'); }

    function ensureBar() {
        let el = bar();
        if (el) return el;
        el = document.createElement('div');
        el.id = 'photo-place-bar';
        document.body.appendChild(el);
        return el;
    }

    function render() {
        const el = ensureBar();
        if (!active) { el.classList.remove('open'); el.innerHTML = ''; return; }
        const { photos, idx, coords } = active;
        const cur = photos[idx];
        const strip = photos.map((p, i) => `
            <button class="pp-thumb${i === idx ? ' active' : ''}" data-i="${i}" title="Фото ${i + 1}">
                <img src="${esc(p.src)}" alt="" loading="lazy">
            </button>`).join('');
        el.innerHTML = `
            <div class="pp-head">
                <div class="pp-title">${coords
                    ? 'Точка поставлена — сохраните или выберите место заново'
                    : 'Нажмите на карте место, где сделано это фото'}</div>
                <button class="pp-x" id="pp-close" aria-label="Выйти">✕</button>
            </div>
            <div class="pp-body">
                <div class="pp-big"><img src="${esc(cur.src)}" alt=""></div>
                <div class="pp-right">
                    <div class="pp-strip scrollbar-hide">${strip}</div>
                    <div class="pp-actions">
                        <button class="pf-btn pf-btn-accent" id="pp-save" ${coords ? '' : 'disabled'}>Сохранить место</button>
                        ${coords ? `<button class="pf-link" id="pp-reset">сбросить</button>` : ''}
                        <span class="pp-hint">${active.snapped
                            ? 'Село на тропу маршрута'
                            : (coords ? 'В стороне от тропы — так и оставим' : 'Точка притянется к тропе, если она рядом')}</span>
                    </div>
                </div>
            </div>`;
        el.classList.add('open');

        el.querySelector('#pp-close').onclick = stop;
        el.querySelector('#pp-save').onclick = save;
        const reset = el.querySelector('#pp-reset');
        if (reset) reset.onclick = () => { active.coords = null; active.snapped = false; paintDot(null); render(); };
        el.querySelectorAll('.pp-thumb').forEach(b => {
            b.onclick = () => {
                active.idx = +b.dataset.i;
                active.coords = null; active.snapped = false;
                paintDot(null);
                render();
            };
        });
    }

    // ── Режим ───────────────────────────────────────────────────────────────

    function start(routeInfo) {
        if (!window.map || !window.RouteStatus) return;
        const all = RouteStatus.photosFor(routeInfo) || [];
        const photos = all.filter(p => !p.coords);
        if (!photos.length) { toast('У всех фото уже есть место на карте'); return; }

        active = { routeInfo, photos, idx: 0, coords: null, snapped: false };
        document.body.classList.add('tw-photo-place');
        ensureLayer();
        paintDot(null);
        render();

        // ⚠️ Клик ставит точку, поэтому обычный обработчик выбора маршрута на
        // это время не нужен: иначе нажатие рядом с чужой меткой открыло бы
        // другой маршрут прямо посреди расстановки
        onClick = e => {
            const data = parsedRouteDataCache[routeInfo.id];
            const raw = [e.lngLat.lng, e.lngLat.lat];
            const snap = snapToRoute(raw, data && data.coordinates);
            const near = snap.dist <= SNAP_M;
            active.coords = near ? snap.coords : raw;
            active.snapped = near;
            paintDot(active.coords);
            render();
        };
        map.on('click', onClick);
    }

    async function save() {
        if (!active || !active.coords) return;
        const { routeInfo, photos, idx, coords } = active;
        const btn = document.getElementById('pp-save');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
        const ok = await RouteStatus.setPhotoCoords(routeInfo, photos[idx].idx, coords);
        if (!ok) { render(); return; }
        toast('Место фото сохранено');
        // Оставшиеся без места — продолжаем с ними; последнее закрывает режим
        const rest = (RouteStatus.photosFor(routeInfo) || []).filter(p => !p.coords);
        if (!rest.length) { stop(); return; }
        active.photos = rest;
        active.idx = 0;
        active.coords = null;
        active.snapped = false;
        paintDot(null);
        render();
        if (window.renderPhotoMapMarkers) renderPhotoMapMarkers(routeInfo);
    }

    function stop() {
        if (onClick && window.map) map.off('click', onClick);
        onClick = null;
        const info = active && active.routeInfo;
        active = null;
        document.body.classList.remove('tw-photo-place');
        paintDot(null);
        clearLayer();
        render();
        if (info && window.renderPhotoMapMarkers) renderPhotoMapMarkers(info);
    }

    window.PhotoPlace = { start, stop, isActive: () => !!active };
})();
