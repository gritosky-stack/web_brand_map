/* ── Профиль высот, раскраска и камера в интерфейсе сайта ─────────────────────
 *
 * Связывает график (`profile_chart.js`), раскраску по уклону
 * (`grade_color.js`), планировщик времени (`time_planner.js`) и
 * кинематографическую камеру (`cinematic.js`) с картой и панелью маршрута.
 *
 * Здесь же живёт то, что в приложении делает `MapboxMapView`:
 *  - бегунок на карте под пальцем и шкала с высотой/километром/участком;
 *  - подсветка выделенного участка **на самой линии маршрута** по
 *    `line-progress`, а не второй линией поверх;
 *  - удержание бегунка в видимой части карты (её обрезают панель и шкала).
 */
(function (root) {
    'use strict';

    const SCRUB_SRC = 'profile-scrub-src';
    const SCRUB_HALO = 'profile-scrub-halo';
    const SCRUB_DOT = 'profile-scrub-dot';
    const SEL_GLOW = 'profile-selection-glow';
    const SEL_LINE = 'profile-selection-line';

    const RouteProfile = {
        chart: null,
        planner: null,
        camera: null,
        routeData: null,
        lineSourceId: null,
        _framing: false,

        get map() { return root.map; },

        // MARK: - Показать маршрут

        /**
         * @param routeInfo описание маршрута из script.js
         * @param routeData разобранная геометрия (с `profile` и `gradeStops`)
         * @param lineSourceId источник линии маршрута — по нему рисуется
         *        подсветка выделенного участка
         */
        show(routeInfo, routeData, lineSourceId) {
            this.hide();
            this.routeData = routeData;
            this.routeInfo = routeInfo;
            this.lineSourceId = lineSourceId;

            const accent = routeInfo.future ? '#FF8C00' : '#ff4d4d';
            const wrapper = document.getElementById('panel-elevation-wrapper');
            const host = document.getElementById('profile-chart');
            const profile = routeData.profile;

            if (!host || !profile || !profile.ele || profile.ele.length < 3) {
                if (wrapper) wrapper.classList.add('hidden');
            } else {
                wrapper.classList.remove('hidden');
                this.chart = new root.ProfileChart(host, {
                    profile,
                    stops: routeData.gradeStops,
                    totalKm: routeData.distance,
                    accent,
                    onScrub: info => this.onScrub(info),
                    onSelect: range => this.onSelect(range)
                });
                // Панель едет из-за края экрана: пока идёт переход, ширина
                // холста ещё не та, что будет в конце
                setTimeout(() => this.chart && this.chart.resize(), 480);
            }

            // Линия на карте упрощена и короче настоящего маршрута на 5–8 %.
            // Чтобы облёт и график говорили об одном месте, держим рядом две
            // шкалы её вершин: метры вдоль самой линии (по ним идёт камера) и
            // километры по полной геометрии (по ним размечен график).
            this._lineMeters = root.GradeColor.cumulativeMeters(routeData.coordinates);
            this._lineKm = routeData.coordKm;
            this._toLine = root.GradeColor.progressMapper(routeData.coordinates, routeData.coordKm);
            this._lineCoords = routeData.coordinates;

            this.showTimePlanner(routeInfo, routeData);
            this.showCameraButtons();
        },

        hide() {
            this.stopCinematic(true);
            if (this.chart) { this.chart.destroy(); this.chart = null; }
            this.clearScrub();
            this.clearSelection();
            this.routeData = null;
            this.routeInfo = null;
            this.lineSourceId = null;
            const buttons = document.getElementById('panel-camera-buttons');
            if (buttons) buttons.classList.add('hidden');
        },

        // MARK: - Планирование времени

        showTimePlanner(routeInfo, routeData) {
            const wrapper = document.getElementById('panel-time-planner-wrapper');
            const host = document.getElementById('time-planner');
            if (!wrapper || !host) return;
            wrapper.classList.remove('hidden');
            if (!this.planner) this.planner = new root.HikingTime.TimePlanner(host);
            // Набор берём тот же, что показан в карточке: с поправкой из
            // описания маршрута, если она есть
            this.planner.setRoute(routeData.distance,
                                  routeInfo.overrideAscent != null ? routeInfo.overrideAscent : routeData.ascent);
        },

        /**
         * Километр маршрута по пройденным вдоль линии метрам. Обе шкалы
         * монотонны и заданы в одних и тех же вершинах — переводим одним
         * бинарным поиском.
         */
        routeKmAt(meters) {
            const cum = this._lineMeters, km = this._lineKm;
            // Старый индекс без `coordKm` — честно возвращаем то, что есть
            if (!cum || !km || km.length !== cum.length) return meters / 1000;
            if (meters <= 0) return km[0];
            const last = cum.length - 1;
            if (meters >= cum[last]) return km[last];
            let lo = 0, hi = last;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] <= meters) lo = mid; else hi = mid;
            }
            const span = cum[hi] - cum[lo];
            const t = span > 0 ? (meters - cum[lo]) / span : 0;
            return km[lo] + (km[hi] - km[lo]) * t;
        },

        // MARK: - Бегунок на карте

        ensureScrubLayers() {
            const map = this.map;
            if (!map) return false;
            // Стиль может быть ещё не разобран (вкладка просыпается из фона,
            // первый кадр облёта). Это не повод падать — метка появится на
            // следующем кадре, их тут шестьдесят в секунду.
            try {
                if (!map.getStyle()) return false;
            } catch (e) { return false; }
            if (!map.getSource(SCRUB_SRC)) {
                map.addSource(SCRUB_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            if (!map.getLayer(SCRUB_HALO)) {
                map.addLayer({
                    id: SCRUB_HALO, type: 'circle', source: SCRUB_SRC,
                    paint: { 'circle-radius': 13, 'circle-color': '#ffffff', 'circle-opacity': 0.22, 'circle-blur': 0.6 }
                });
            }
            if (!map.getLayer(SCRUB_DOT)) {
                map.addLayer({
                    id: SCRUB_DOT, type: 'circle', source: SCRUB_SRC,
                    paint: {
                        'circle-radius': 6, 'circle-color': '#ffffff',
                        'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(9,9,11,.85)'
                    }
                });
            }
            return true;
        },

        /**
         * Бегунок обязан остаться над подсветкой участка и над метками фото:
         * именно его в этот момент и высматривают.
         */
        raiseScrubLayers() {
            const map = this.map;
            [SCRUB_HALO, SCRUB_DOT].forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
        },

        /**
         * Точка **на нарисованной линии**, соответствующая километру маршрута.
         *
         * ⚠️ Бегунок ставим сюда, а не в GPS-точку профиля. Линия упрощена, и
         * на узких местах (ответвление туда-обратно, серпантин) настоящая
         * точка лежала в десятках метров от линии — между двумя её нитками,
         * и было не понять, на каком цвете она стоит (фидбэк 2026-09-19).
         * Здесь же берётся и цвет линии (`progressMapper`), так что бегунок
         * стоит ровно на том цвете, что и точка на графике.
         */
        lineCoordAtKm(km) {
            const coords = this._lineCoords, cum = this._lineMeters;
            const total = this.chart ? this.chart.totalKm : 0;
            if (!coords || !cum || coords.length < 2 || !(total > 0) || !this._toLine) return null;
            const meters = this._toLine(km / total) * cum[cum.length - 1];
            let lo = 0, hi = cum.length - 1;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] <= meters) lo = mid; else hi = mid;
            }
            const span = cum[hi] - cum[lo];
            const t = span > 0 ? Math.min(1, Math.max(0, (meters - cum[lo]) / span)) : 0;
            return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
                    coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
        },

        onScrub(info) {
            const bar = document.getElementById('scrub-readout');
            if (!info) {
                this.clearScrub();
                return;
            }
            const at = this.lineCoordAtKm(info.km) || info.lngLat;
            if (this.ensureScrubLayers()) {
                this.map.getSource(SCRUB_SRC).setData({
                    type: 'FeatureCollection',
                    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }]
                });
                this.raiseScrubLayers();
            }
            if (bar) {
                bar.innerHTML = this.readoutHTML(info);
                bar.classList.remove('hidden');
                document.body.classList.add('tw-immersive');
                document.body.classList.add('tw-scrubbing');
            }
            this.keepScrubVisible(at);
        },

        /**
         * Шкала: высота, пройденный километр и участок под пальцем — то же,
         * что «Segment length» и «Type» в подсказке brouter.de.
         *
         * ⚠️ Длина участка здесь всегда в километрах, даже когда это
         * полкилометра: рядом стоит высота в метрах, и «652 м» читалось как
         * ещё одна высота, а не как длина куска.
         */
        readoutHTML(info) {
            const GC = root.GradeColor;
            // ⚠️ Пока камера подлетает к началу маршрута, данных о точке ещё
            // нет — но место под них уже занято прочерками. Иначе блок
            // появлялся секундой позже и сдвигал собой кнопки: скорость и
            // «Стоп» прыгали влево одним кадром.
            if (!info) {
                const total = this.routeData ? this.routeData.distance.toFixed(1) : '—';
                return `<span class="sr-group"><span class="sr-icon">▲</span>` +
                       `<b>—</b><span class="sr-unit">м</span></span>` +
                       `<span class="sr-sep"></span>` +
                       `<span class="sr-group"><b>—</b>` +
                       `<span class="sr-unit">/ ${total} км</span></span>` +
                       `<span class="sr-sep"></span>` +
                       `<span class="sr-group"><b>—</b></span>`;
            }
            let html =
                `<span class="sr-group"><span class="sr-icon">▲</span>` +
                `<b>${Math.round(info.elevation)}</b><span class="sr-unit">м</span></span>` +
                `<span class="sr-sep"></span>` +
                `<span class="sr-group"><b>${info.km.toFixed(1)}</b>` +
                `<span class="sr-unit">/ ${info.totalKm.toFixed(1)} км</span></span>`;
            if (info.segmentKm != null && info.segmentGrade != null) {
                const color = GC.cssForGrade(info.segmentGrade);
                const arrow = info.segmentGrade > 2 ? '↗' : info.segmentGrade < -2 ? '↘' : '→';
                html += `<span class="sr-sep"></span>` +
                    `<span class="sr-group" style="color:${color}"><span class="sr-icon">${arrow}</span>` +
                    `<b>${root.ProfileBands.gradeLabel(info.segmentGrade)}</b></span>` +
                    `<span class="sr-unit">${info.segmentKm.toFixed(1)} км</span>`;
            }
            return html;
        },

        /**
         * Метка облёта в полёте — обычный элемент в центре свободной части
         * экрана, а не точка в источнике карты.
         *
         * ⚠️ Камера каждый кадр встаёт центром ровно на эту точку тропы, так
         * что на экране метка стоит на месте, а движется земля под ней.
         * Через `setData` она приезжала с опозданием: источник карты
         * обновляется в воркере, асинхронно, на кадр-два позже камеры и
         * каждый раз с разной задержкой — метка дрожала вокруг центра, и
         * облёт казался рывками (фидбэк 2026-09-19). Элемент ставится в тот
         * же кадр, что и камера. На паузе карту двигают руками — там метка
         * снова точка на карте (`onPauseChanged`).
         */
        placeFlyoverDot() {
            const camera = this.camera;
            if (!camera || camera.paused) return;
            let dot = document.getElementById('flyover-dot');
            if (!dot) {
                dot = document.createElement('div');
                dot.id = 'flyover-dot';
                document.body.appendChild(dot);
            }
            // Ставим в экранную точку тропы (`project` — синхронно, тем же
            // кадром, что и камера). ⚠️ Не в центр кадра «по построению»:
            // пока тайл рельефа под камерой не приехал, центр стоит на нулевой
            // высоте, тропа проецируется в сторону — и метка висела в
            // пустоте далеко от линии (фидбэк 2026-09-19).
            const box = this.map.getCanvas().getBoundingClientRect();
            const p = this._flyCoord ? this.map.project(this._flyCoord) : null;
            if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
            dot.style.transform = `translate(${box.left + p.x}px, ${box.top + p.y}px)`;
            if (dot.hidden) dot.hidden = false;
            if (!this._flyDotShown) {
                this._flyDotShown = true;
                const source = this.map.getSource(SCRUB_SRC);
                if (source) source.setData({ type: 'FeatureCollection', features: [] });
            }
        },

        hideFlyoverDot() {
            const dot = document.getElementById('flyover-dot');
            if (dot) dot.hidden = true;
            this._flyDotShown = false;
        },

        clearScrub() {
            this.hideFlyoverDot();
            const bar = document.getElementById('scrub-readout');
            if (bar) bar.classList.add('hidden');
            document.body.classList.remove('tw-scrubbing');
            if (!this.camera || !this.camera.isRunning) document.body.classList.remove('tw-immersive');
            const map = this.map;
            if (map && map.getSource(SCRUB_SRC)) {
                map.getSource(SCRUB_SRC).setData({ type: 'FeatureCollection', features: [] });
            }
        },

        // MARK: - Кадр карты

        /** Свободная часть карты: её обрезают панель маршрута и шкала сверху */
        padding() {
            const group = document.getElementById('route-panel-group');
            const open = group && group.classList.contains('sidebar-open')
                      && !group.classList.contains('panel-collapsed');
            const desktop = window.innerWidth >= 768;
            // Карточка профиля во время облёта тоже закрывает карту снизу —
            // без этого метка «где мы сейчас» уезжает под неё
            const card = document.getElementById('flyover-profile');
            const cardHeight = card && !card.classList.contains('hidden')
                ? Math.round(card.getBoundingClientRect().height) : 0;
            if (desktop) {
                return { top: 90, right: 60, bottom: 60 + cardHeight, left: open ? 420 : 60 };
            }
            return {
                top: 90, right: 24, left: 24,
                bottom: (open ? Math.round(window.innerHeight * 0.58) + 40 : 60) + cardHeight
            };
        },

        /**
         * Бегунок ушёл из видимой части карты — показываем маршрут целиком
         * (или выделенный участок), а не гонимся за точкой: гнаться значит
         * непрерывно двигать карту под пальцем, и по ней перестаёт быть
         * понятно, где ты вообще находишься.
         */
        keepScrubVisible(lngLat) {
            const map = this.map;
            if (!map || this._framing || !this.routeData) return;
            // Камеру ведёт вращение — не перебиваем его своими перелётами
            if (this.camera && this.camera.isRunning && !this.camera.paused) return;
            const pad = this.padding();
            const box = map.getCanvas().getBoundingClientRect();
            const p = map.project(lngLat);
            const inside = p.x > pad.left && p.x < box.width - pad.right
                        && p.y > pad.top && p.y < box.height - pad.bottom;
            if (inside) return;

            const coords = (this.selectionCoords && this.selectionCoords.length)
                ? this.selectionCoords : this.routeData.coordinates;
            this.fitCoordinates(coords, { duration: 700, maxZoom: 15 });
        },

        fitCoordinates(coords, opts) {
            const map = this.map;
            if (!coords || !coords.length) return;
            let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
            for (const c of coords) {
                if (c[0] < minLon) minLon = c[0];
                if (c[0] > maxLon) maxLon = c[0];
                if (c[1] < minLat) minLat = c[1];
                if (c[1] > maxLat) maxLat = c[1];
            }
            this._framing = true;
            const bounds = [[minLon, minLat], [maxLon, maxLat]];
            const o = Object.assign({ duration: 800, maxZoom: 16 }, opts || {});
            const want = { padding: o.padding || this.padding(), maxZoom: o.maxZoom,
                           bearing: o.bearing || 0, pitch: o.pitch || 0 };

            // ⚠️ Кадр считаем при **нулевых** отступах самой карты и летим
            // в него, сбрасывая их. Mapbox вычитает из экрана и переданный
            // `padding`, и тот, что остался у карты с прошлого раза, — а
            // облёт и вращение оставляют ей отступ под карточку снизу. На
            // телефоне два отступа съедали весь экран, `fitBounds` молча не
            // делал ничего, и камера не отъезжала ни после облёта, ни когда
            // бегунок графика уходил за край (фидбэк 2026-09-19).
            const tr = map.transform;
            const saved = map.getPadding();
            const zero = { top: 0, right: 0, bottom: 0, left: 0 };
            // Не влезло — Mapbox не всегда возвращает пустоту, бывает и
            // исключение (NaN в координатах): оно и обрывало перелёт
            const fit = options => {
                try { return map.cameraForBounds(bounds, options); } catch (e) { return null; }
            };
            tr.padding = zero;
            let camera = fit(want);
            // Над развёрнутой карточкой на телефоне свободна узкая полоса —
            // если маршрут не влез, пробуем отступы поменьше и без наклона
            if (!camera) {
                const pad = want.padding;
                want.padding = { top: Math.min(pad.top, 30), left: Math.min(pad.left, 16),
                                 right: Math.min(pad.right, 16), bottom: Math.round(pad.bottom * 0.75) };
                camera = fit(want) || fit(Object.assign({}, want, { pitch: 0 }));
            }
            tr.padding = saved;
            if (!camera) { this._framing = false; return; }
            map.flyTo(Object.assign({}, camera, {
                padding: zero, duration: o.duration, essential: true
            }));
            // Пока летим — считаем, что кадр уже подобран: иначе следующий же
            // кадр ведения решит, что бегунок снова вне экрана, и кадры
            // начнут затирать друг друга
            map.once('moveend', () => { this._framing = false; });
            setTimeout(() => { this._framing = false; }, (opts && opts.duration ? opts.duration : 800) + 200);
        },

        // MARK: - Выделенный участок

        onSelect(range) {
            this.clearSelection();
            if (!range) return;
            this.selectionCoords = range.coordinates;
            this.drawSelection(range.fromFraction, range.toFraction);
            // Облёт к участку — так же, как в приложении: выделили, чтобы
            // рассмотреть именно его. ⚠️ Кроме случая, когда камера уже
            // занята вращением: перелёт начинался и тут же гас под следующим
            // кадром вращения (фидбэк 2026-09-19) — только подсвечиваем
            if (this.camera && this.camera.isRunning && !this.camera.paused) return;
            this.fitCoordinates(range.coordinates, { duration: 900, maxZoom: 16 });
        },

        /**
         * Подсветка участка — **на самой линии маршрута**, а не второй линией
         * поверх неё.
         *
         * ⚠️ Отдельная ломаная из координат графика срезала бы повороты:
         * точки профиля прорежены, и на извилистой тропе подсветка шла бы
         * рядом с маршрутом, местами в стороне на пол-экрана. Тот же источник
         * плюс `line-progress` дают совпадение с тропой по построению.
         *
         * Белая, а не ещё один цвет уклона: линия и так раскрашена по
         * крутизне, и любой цветной ореол читался бы как «здесь другой уклон».
         */
        drawSelection(from, to) {
            const map = this.map;
            const source = this.lineSourceId;
            if (!map || !source || !map.getSource(source)) return;
            // Границы выделения — доли полной геометрии, а `line-progress`
            // считается по упрощённой линии: переводим, иначе подсветка
            // сползала с выделенного на графике куска
            const toLine = this._toLine || (f => f);
            const gradient = RouteProfile.selectionGradient(toLine(from), toLine(to));
            if (!gradient) return;

            map.addLayer({
                id: SEL_GLOW, type: 'line', source,
                layout: { 'line-cap': 'butt', 'line-join': 'round' },
                paint: {
                    'line-gradient': gradient, 'line-width': 15,
                    'line-opacity': 0.42, 'line-blur': 6
                }
            }, root.drapeBeforeId && root.drapeBeforeId());
            map.addLayer({
                id: SEL_LINE, type: 'line', source,
                layout: { 'line-cap': 'butt', 'line-join': 'round' },
                paint: { 'line-gradient': gradient, 'line-width': 2, 'line-opacity': 0.9 }
            }, root.drapeBeforeId && root.drapeBeforeId());
            this.raiseScrubLayers();
        },

        /**
         * Белый внутри участка, прозрачный снаружи.
         *
         * ⚠️ Узлы `interpolate` обязаны строго возрастать: выделение шириной в
         * одну точку графика дало бы два одинаковых узла, и выражение молча
         * отвалилось бы вместе со всей подсветкой. Поэтому границы отбиваются
         * переходом в четверть процента длины — без него край подсветки на
         * длинном маршруте выглядит как обрыв линии.
         */
        selectionGradient(from, to) {
            const edge = 0.0025;
            const lower = Math.min(Math.max(from, 0), 1);
            const upper = Math.min(Math.max(to, 0), 1);
            if (!(upper - lower > 0)) return null;

            const stops = [];
            const add = (position, alpha) => {
                const p = Math.min(Math.max(position, 0), 1);
                if (stops.length && p <= stops[stops.length - 1][0] + 1e-6) return;
                stops.push([p, alpha]);
            };
            add(0, lower > edge ? 0 : 1);
            add(lower - edge, 0);
            add(lower, 1);
            add(upper, 1);
            add(upper + edge, 0);
            add(1, 0);
            if (stops.length < 2) return null;

            const expr = ['interpolate', ['linear'], ['line-progress']];
            for (const [position, alpha] of stops) expr.push(position, `rgba(255,255,255,${alpha})`);
            return expr;
        },

        clearSelection() {
            const map = this.map;
            this.selectionCoords = null;
            if (!map || !map.getStyle) return;
            [SEL_LINE, SEL_GLOW].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        },

        // MARK: - Камера

        showCameraButtons() {
            const box = document.getElementById('panel-camera-buttons');
            if (!box) return;
            box.classList.remove('hidden');
            box.classList.add('flex');
            if (box.dataset.bound) return;
            box.dataset.bound = '1';
            document.getElementById('btn-flyover').addEventListener('click', () => this.requestCinematic('flyover'));
            document.getElementById('btn-orbit').addEventListener('click', () => this.requestCinematic('orbit'));
            // Кнопок «Стоп» и рядов скоростей два — у вращения своя плашка,
            // у облёта своя карточка снизу; ведут они себя одинаково
            document.querySelectorAll('[data-cinematic-stop]').forEach(btn =>
                btn.addEventListener('click', () => this.stopCinematic()));
            const pause = document.getElementById('btn-flyover-pause');
            if (pause) pause.addEventListener('click', () => this.togglePause());
            document.querySelectorAll('.cine-speed').forEach(btn => {
                btn.addEventListener('click', () => this.setSpeed(+btn.dataset.speed));
            });
            this.setSpeed(this.savedSpeed(), { remember: false });
        },

        savedSpeed() {
            try { return +localStorage.getItem('tw.flyoverSpeed') || 1; } catch (e) { return 1; }
        },

        setSpeed(value, opts) {
            this._speed = value;
            if (this.camera) this.camera.setSpeed(value);
            if (!opts || opts.remember !== false) {
                try { localStorage.setItem('tw.flyoverSpeed', String(value)); } catch (e) {}
            }
            document.querySelectorAll('.cine-speed')
                .forEach(b => b.classList.toggle('active', +b.dataset.speed === value));
        },

        ensureCamera() {
            if (!this.camera && this.map) {
                this.camera = new root.CinematicCamera(this.map);
                this.camera.onStop = () => this.onCinematicStopped();
                this.camera.onPauseChange = paused => this.onPauseChanged(paused);
            }
            return this.camera;
        },

        /**
         * Пауза облёта. На паузе карта целиком в руках человека — крутить,
         * приближать, ходить по ней; режим при этом не кончается, карточка
         * остаётся, и «Продолжить» возвращает камеру на тот же метр.
         */
        togglePause() {
            const camera = this.camera;
            if (!camera || !camera.isRunning) return;
            if (camera.paused) camera.resume(); else camera.pause();
        },

        onPauseChanged(paused) {
            // На паузе карту двигают руками — метка становится точкой на
            // самой карте, иначе она осталась бы висеть в центре экрана
            if (paused && this._flyoverUnderway && this._flyCoord) {
                this.hideFlyoverDot();
                if (this.ensureScrubLayers()) {
                    this.map.getSource(SCRUB_SRC).setData({
                        type: 'FeatureCollection',
                        features: [{ type: 'Feature', properties: {},
                                     geometry: { type: 'Point', coordinates: this._flyCoord } }]
                    });
                    this.raiseScrubLayers();
                }
            }
            const button = document.getElementById('btn-flyover-pause');
            if (button) {
                // Иконкой, а не словом: «Продолжить» раздувало плашку облёта
                button.innerHTML = paused
                    ? '<svg viewBox="0 0 12 12"><path d="M3.5 2.2v7.6L10 6z" fill="currentColor"/></svg>'
                    : '<svg viewBox="0 0 12 12"><rect x="2.5" y="2" width="2.4" height="8" rx=".8" fill="currentColor"/>' +
                      '<rect x="7.1" y="2" width="2.4" height="8" rx=".8" fill="currentColor"/></svg>';
                const label = paused ? 'Продолжить' : 'Пауза';
                button.title = label;
                button.setAttribute('aria-label', label);
                button.classList.toggle('resumed', paused);
            }
            const card = document.getElementById('flyover-profile');
            if (card) card.classList.toggle('paused', paused);
        },

        /** Нажали кнопку. Тот же режим вторым нажатием — это «стоп». */
        requestCinematic(mode) {
            const camera = this.ensureCamera();
            if (!camera || !this.routeData) return;
            if (camera.mode === mode) { this.stopCinematic(); return; }

            this.prepareForCinematic(mode);
            const route = this.routeData.coordinates;
            // Камера сама бросает предыдущий режим, и его «остановку» нельзя
            // разбирать как обычную: иначе переключение вращения на облёт
            // успевало вернуть карточку и убрать метки ровно перед стартом
            this._switching = true;
            this._cineMode = mode;
            if (mode === 'flyover') {
                camera.onProgress = (coord, progress, travelledMeters) =>
                    this.onFlyoverProgress(coord, travelledMeters);
                camera.startFlyover(route, {
                    speed: this._speed || 1,
                    padding: this.padding(),
                    // Метку «где мы сейчас» показываем только когда камера уже
                    // пошла по тропе: во время подлёта её место в центре
                    // экрана — не точка маршрута, а случайный кусок леса
                    onStarted: () => { this._flyoverUnderway = true; },
                    // Кадр «весь маршрут» после облёта ставит onCinematicStopped
                    onFinish: null
                });
            } else {
                camera.onProgress = null;
                camera.startOrbit(route, { padding: this.padding() });
            }
            this._switching = false;
            this.showCinematicStatus(mode);
        },

        /** Общая подготовка: убрать всё, что перебивает камеру или закрывает вид */
        prepareForCinematic(mode) {
            // Метки фото прячем только под облёт: он идёт низко над тропой, и
            // они там густо закрывают вид. Бейджи старта/финиша/вершины
            // остаются всегда — по ним и читается, где начало и где верх.
            if (root.setRouteDecorationsHidden) root.setRouteDecorationsHidden(mode === 'flyover');
            // Карточку облёта убираем до того, как считаем свободную часть
            // экрана: иначе вращение подберёт кадр с запасом под неё снизу
            if (mode !== 'flyover') this.hideFlyoverCard();
            if (this.chart) this.chart.endScrub();
            this.clearScrub();
            this._flyoverUnderway = false;
            // ⚠️ Сворачиваем панель только под облёт: он идёт низко над тропой,
            // и половина экрана под карточку — это половина полёта за кадром.
            // Вместо карточки внизу появляется профиль (`showFlyoverCard`).
            // Вращение же показывает маршрут целиком и как раз рядом с
            // карточкой — её и оставляем открытой, а свернуть её можно
            // стрелочкой, не останавливая камеру.
            const group = document.getElementById('route-panel-group');
            if (group && mode === 'flyover') group.classList.add('panel-collapsed');
        },

        /**
         * `quiet` — камеру гасим, потому что маршрут закрыли или сменили:
         * тогда никакого «показать маршрут целиком» после облёта не нужно,
         * камера уже летит в другое место.
         */
        stopCinematic(quiet) {
            this._quietStop = !!quiet;
            if (this.camera && this.camera.isRunning) this.camera.stop();
            else this.onCinematicStopped();
            this._quietStop = false;
        },

        onCinematicStopped() {
            // Метку «где мы сейчас» снимаем всегда: при смене режима облёт
            // кончился, и его точка иначе остаётся висеть на карте — часто
            // в стороне от маршрута, будто съехала метка старта
            this.clearScrub();
            this._flyoverUnderway = false;
            // Дальше — это не «камеру остановили», а «один режим сменился
            // другим»: разбирать интерфейс незачем, его сейчас соберут заново
            if (this._switching) return;
            if (root.setRouteDecorationsHidden) root.setRouteDecorationsHidden(false);
            const status = document.getElementById('cinematic-status');
            if (status) status.classList.add('hidden');
            document.body.classList.remove('tw-immersive');
            ['btn-flyover', 'btn-orbit'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });
            this.hideFlyoverCard();
            this.clearScrub();
            this._flyoverUnderway = false;

            // Карточку возвращаем — кроме случая, когда камеру забрали у нас
            // касанием карты: тогда на карту и смотрят, и разворачивать поверх
            // неё панель значит закрыть ровно то, ради чего её забрали
            const group = document.getElementById('route-panel-group');
            const byUser = this.camera && this.camera.stoppedByUser;
            if (group && this.routeData && !byUser) group.classList.remove('panel-collapsed');
            if (this.camera) this.camera.stoppedByUser = false;

            // Облёт кончился — долетели или нажали «Стоп» — показываем маршрут
            // целиком: иначе камера остаётся носом в склон, и непонятно, где
            // ты вообще оказался. ⚠️ Раньше это делалось только на долёте до
            // конца, и на телефоне после «Стоп» камера так и висела низко над
            // тропой (фидбэк 2026-09-19). Наклон — как при открытии маршрута:
            // с 64° облёта маршрут над развёрнутой карточкой не вписывается.
            const wasFlyover = this._cineMode === 'flyover';
            this._cineMode = null;
            if (wasFlyover && !byUser && !this._quietStop && this.routeData) {
                this.fitCoordinates(this.routeData.coordinates, { duration: 1400, maxZoom: 15, pitch: 45 });
            }
        },

        showCinematicStatus(mode) {
            ['btn-flyover', 'btn-orbit'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.toggle('active',
                    id === (mode === 'flyover' ? 'btn-flyover' : 'btn-orbit'));
            });
            document.body.classList.add('tw-immersive');

            const status = document.getElementById('cinematic-status');
            if (mode === 'flyover') {
                if (status) status.classList.add('hidden');
                this.showFlyoverCard();
                return;
            }
            this.hideFlyoverCard();
            if (!status) return;
            status.classList.remove('hidden');
            status.querySelector('#cinematic-title').textContent = 'Вращение вокруг маршрута';
            // Скорость имеет смысл только у облёта: вращение идёт с постоянной
            // угловой скоростью, и «×2» у него значило бы другое
            document.getElementById('cinematic-speeds').style.display = 'none';
        },

        // MARK: - Профиль во время облёта

        /**
         * Широкая карточка профиля снизу. Бегунок на ней и метка на тропе —
         * одна и та же точка: по графику видно, где камера идёт сейчас и что
         * будет дальше, а по карте — что именно это за место.
         */
        showFlyoverCard() {
            const card = document.getElementById('flyover-profile');
            const host = document.getElementById('fp-chart');
            if (!card || !host || !this.routeData || !this.routeData.profile) return;
            card.classList.remove('hidden');
            // Стрелочка свёрнутой панели висит внизу по центру — ровно там,
            // где у карточки ось с километрами; на телефоне она накрывала
            // подпись под бегунком
            document.body.classList.add('tw-flyover');
            this.onPauseChanged(false);
            // Метка облёта пойдёт поверх всего, что успело лечь на карту
            if (this.ensureScrubLayers()) this.raiseScrubLayers();
            this.hideFlyoverChart();
            this.flyoverChart = new root.ProfileChart(host, {
                profile: this.routeData.profile,
                stops: this.routeData.gradeStops,
                totalKm: this.routeData.distance,
                accent: this.routeInfo && this.routeInfo.future ? '#FF8C00' : '#ff4d4d',
                interactive: false,
                height: window.innerWidth < 768 ? 64 : 84
            });
            const readout = document.getElementById('fp-readout');
            if (readout) readout.innerHTML = this.readoutHTML(null);
            // Карточка появилась уже после того, как камера взяла кадр —
            // отдаём ей новую свободную часть экрана
            if (this.camera) this.camera.padding = this.padding();
        },

        hideFlyoverCard() {
            const card = document.getElementById('flyover-profile');
            if (card) { card.classList.add('hidden'); card.classList.remove('paused'); }
            document.body.classList.remove('tw-flyover');
            this.hideFlyoverChart();
        },

        hideFlyoverChart() {
            if (!this.flyoverChart) return;
            this.flyoverChart.destroy();
            this.flyoverChart = null;
        },

        /** Кадр облёта: метка на тропе, бегунок на графике и цифры над ним */
        onFlyoverProgress(coord, travelledMeters) {
            if (!this._flyoverUnderway) return;
            this._flyCoord = coord;
            this.placeFlyoverDot();
            if (!this.flyoverChart) return;
            const info = this.flyoverChart.setCursor(this.routeKmAt(travelledMeters));
            const readout = document.getElementById('fp-readout');
            if (info && readout) readout.innerHTML = this.readoutHTML(info);
        },

        /**
         * Карточку свернули или вернули прямо во время движения камеры —
         * свободная часть экрана стала другой, и кадр надо пересобрать.
         * Саму камеру при этом не трогаем: стрелочка не «стоп».
         */
        onPanelToggled() {
            if (!this.camera || !this.camera.isRunning) return;
            // 450 мс — ровно столько же едет сама панель (её переход в CSS),
            // так что карта растягивается вслед за ней, а не рывком в конце
            this.camera.updatePadding(this.padding(), 450);
        }
    };

    root.RouteProfile = RouteProfile;
})(typeof globalThis !== 'undefined' ? globalThis : window);
