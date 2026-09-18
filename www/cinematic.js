/* ── Камера, которая показывает маршрут сама ──────────────────────────────────
 *
 * Порт `CinematicCamera.swift` и обвязки `MapboxMapView+Cinematic.swift`:
 * облёт вдоль тропы и вращение вокруг неё.
 *
 * Почему покадровое ведение (requestAnimationFrame + jumpTo), а не цепочка
 * `flyTo`/`easeTo`:
 *  - у облёта азимут меняется **непрерывно** и вслед за поворотами тропы, а
 *    `easeTo` умеет только «из этой позы в ту» и на повороте срезал бы угол;
 *  - вращение должно идти с постоянной угловой скоростью и без швов, а
 *    склейка из отрезков по 90° видна глазом на стыках;
 *  - остановить нужно мгновенно, по первому касанию карты, — а не дождавшись
 *    конца текущей анимации.
 */
(function (root) {
    'use strict';

    // ── Настройки движения ───────────────────────────────────────────────────

    // Наклон для облёта. Ниже — вид «из-за плеча», выше — почти вид сверху,
    // на котором пропадает весь смысл рельефа.
    const FLYOVER_PITCH = 64;
    // Зум облёта: на широте Сербии это примерно 1.7 м на точку экрана — тропа
    // читается вместе с формой склона вокруг неё.
    const FLYOVER_ZOOM = 15.2;
    // Наклон вращения — рельеф ещё объёмный, но маршрут целиком лежит в кадре
    const ORBIT_PITCH = 58;
    // Полный оборот, секунд
    const ORBIT_PERIOD = 52;

    /**
     * Скорость облёта по земле, м/с при множителе ×1.
     *
     * ⚠️ Задана **скоростью**, а не длительностью. Длительность (сколько-то
     * секунд на маршрут любой длины) означала, что по десятикилометровой тропе
     * камера ползёт, а по двадцатипятикилометровой несётся: зум-то постоянный,
     * и на экране это разная скорость.
     */
    const FLYOVER_METERS_PER_SECOND = 480;
    // Короче этого облёт не делаем: на двухкилометровой прогулке честная
    // скорость дала бы четыре секунды, и смотреть было бы нечего
    const MIN_FLYOVER_DURATION = 14;

    const SPEEDS = [0.5, 1, 1.5, 2, 3];

    // ── Геометрия ────────────────────────────────────────────────────────────

    const rad = d => d * Math.PI / 180;
    const deg = r => r * 180 / Math.PI;

    function normalize(degrees) {
        const value = degrees % 360;
        return value < 0 ? value + 360 : value;
    }

    /** Кратчайший поворот из одного азимута в другой, −180…180 */
    function shortestTurn(from, to) {
        let delta = (to - from) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return delta;
    }

    /** Начальный азимут по дуге большого круга */
    function bearing(from, to) {
        const φ1 = rad(from[1]), φ2 = rad(to[1]);
        const Δλ = rad(to[0] - from[0]);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        return normalize(deg(Math.atan2(y, x)));
    }

    /** Середина габаритной рамки набора точек */
    function centroid(points) {
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const c of points) {
            if (c[0] < minLon) minLon = c[0];
            if (c[0] > maxLon) maxLon = c[0];
            if (c[1] < minLat) minLat = c[1];
            if (c[1] > maxLat) maxLat = c[1];
        }
        return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
    }

    /**
     * Кадр вращения: какой зум нужен, чтобы маршрут целиком влез при данном
     * азимуте.
     *
     * ⚠️ Габарит считается **на каждый азимут** — сколько маршрут занимает
     * поперёк экрана и сколько вдоль. Описанная окружность одинакова с любой
     * стороны и потому годилась бы на весь оборот, но она описана вокруг
     * вытянутого маршрута: на портретном экране в неё влезает вчетверо меньше
     * полезного, и 24-километровый переход показывался с зума 10, где от него
     * оставалась чёрточка. Размах «дыхания» ограничен, иначе оно читается как
     * рывки зума.
     */
    class OrbitFit {
        constructor(route, safeWidth, safeHeight) {
            const center = centroid(route);
            this.latitude = center[1];
            const metersPerDegreeLat = 111320;
            const metersPerDegreeLon = Math.max(1, metersPerDegreeLat * Math.cos(rad(center[1])));

            // Сотни точек для габарита не нужны — нужен размер, а не форма
            const step = Math.max(1, Math.floor(route.length / 200));
            this.east = [];
            this.north = [];
            for (let i = 0; i < route.length; i += step) {
                this.east.push((route[i][0] - center[0]) * metersPerDegreeLon);
                this.north.push((route[i][1] - center[1]) * metersPerDegreeLat);
            }

            // ⚠️ С запасом по обеим сторонам. Габарит считается по плоской
            // земле, а камера наклонена: кадр на самом деле трапеция, и у
            // ближнего края масштаб заметно крупнее среднего. Без запаса
            // маршрут, красиво влезавший при одном азимуте, вылезал за край
            // через четверть оборота.
            this.safeWidth = safeWidth * 0.80;
            this.safeHeight = safeHeight * 0.72;

            // Самый неудобный азимут задаёт «пол», от него и меряем размах
            let lowest = Infinity;
            for (let d = 0; d < 360; d += 5) lowest = Math.min(lowest, this.rawZoom(d));
            this.floorZoom = Math.min(OrbitFit.maxZoom, Math.max(5, lowest));
            this.ceilingZoom = Math.min(OrbitFit.maxZoom, this.floorZoom + OrbitFit.swing);
        }

        zoomForBearing(b) {
            return Math.min(this.ceilingZoom, Math.max(this.floorZoom, this.rawZoom(b)));
        }

        /** Зум, при котором габарит маршрута ровно вписывается в кадр */
        rawZoom(b) {
            if (!this.east.length || this.safeWidth < 1 || this.safeHeight < 1) return 12;
            const cosB = Math.cos(rad(b)), sinB = Math.sin(rad(b));
            let minAcross = Infinity, maxAcross = -Infinity, minAlong = Infinity, maxAlong = -Infinity;
            for (let i = 0; i < this.east.length; i++) {
                const across = this.east[i] * cosB - this.north[i] * sinB;
                const along = this.east[i] * sinB + this.north[i] * cosB;
                if (across < minAcross) minAcross = across;
                if (across > maxAcross) maxAcross = across;
                if (along < minAlong) minAlong = along;
                if (along > maxAlong) maxAlong = along;
            }
            const metersPerPoint = Math.max((maxAcross - minAcross) / this.safeWidth,
                                            (maxAlong - minAlong) / this.safeHeight);
            if (!(metersPerPoint > 0)) return OrbitFit.maxZoom;
            // Ширина мира у Mapbox — 512 точек на зум
            const equator = 78271.516 * Math.cos(rad(this.latitude));
            return Math.log2(equator / metersPerPoint);
        }
    }

    // Насколько ближе самого «неудобного» азимута разрешено подъезжать
    OrbitFit.swing = 0.5;
    OrbitFit.maxZoom = 15.5;

    // ── Камера ───────────────────────────────────────────────────────────────

    class CinematicCamera {
        constructor(map) {
            this.map = map;
            this.mode = 'off';
            this.paused = false;
            this.speed = 1;
            this._frame = null;
            this._onFinish = null;
            // Каждый запуск получает свой номер: отложенные колбэки (подлёт в
            // стартовую позу) проверяют его и не будят цикл, который уже не
            // тот. ⚠️ Без этого «остановили и сразу запустили снова» оставляло
            // два покадровых цикла на одной карте — они двигали камеру каждый
            // по-своему, и вращение начинало дёргаться, а после остановки
            // дёргалось уже обычное управление мышью.
            this._token = 0;
            this._watchUser();
        }

        get isRunning() { return this.mode !== 'off'; }

        /**
         * Камера бросается по первому касанию карты рукой — но по-разному:
         * облёт встаёт на паузу (можно осмотреться и продолжить с того же
         * места), вращение прекращается совсем. Отбирать управление ровно
         * тогда, когда его только что попросили обратно, нельзя ни в том, ни
         * в другом случае.
         */
        _watchUser() {
            const canvas = this.map.getCanvasContainer();
            const bail = () => {
                if (!this.isRunning || this.paused) return;
                // ⚠️ `stoppedByUser` ставим только на настоящей остановке:
                // пауза — это не «камеру забрали», и после неё карточку
                // маршрута вернуть как раз надо
                if (this.mode === 'flyover') { this.pause(); return; }
                this.stoppedByUser = true;
                this.stop();
            };
            ['mousedown', 'touchstart', 'wheel', 'dblclick'].forEach(type =>
                canvas.addEventListener(type, bail, { passive: true }));
        }

        /**
         * Летим вдоль маршрута, поворачивая вслед за тропой.
         *
         * Сначала камера обычным `easeTo` встаёт в стартовую позу — иначе
         * первый же кадр швырнул бы её через полстраны, — и только потом
         * включается покадровое ведение.
         *
         * `onStarted` — камера встала в стартовую позу и пошла по маршруту.
         * ⚠️ Не то же, что «нажали кнопку»: до этого идёт подлёт к началу
         * маршрута, и всё это время метка «где мы сейчас» показывала бы центр
         * экрана, то есть неправду.
         */
        startFlyover(route, opts) {
            opts = opts || {};
            if (!route || route.length < 2) return;
            this.stop();

            this.points = route;
            this.cumulative = this._cumulativeMeters(route);
            this.totalMeters = this.cumulative[this.cumulative.length - 1];
            if (!(this.totalMeters > 50)) return;

            this.padding = opts.padding || { top: 0, right: 0, bottom: 0, left: 0 };
            this.speed = opts.speed || 1;
            this.stoppedByUser = false;
            this.duration = Math.max(MIN_FLYOVER_DURATION, this.totalMeters / FLYOVER_METERS_PER_SECOND);
            this.elapsed = 0;
            this.mode = 'flyover';
            this._onFinish = opts.onFinish || null;
            const token = ++this._token;

            // Насколько вперёд смотрит камера: слишком близко — азимут пляшет
            // на каждом изгибе тропы, слишком далеко — камера срезает повороты
            this.lookAhead = Math.min(700, Math.max(180, this.totalMeters * 0.02));

            const start = this._coordinateAt(0);
            this.heading = bearing(start, this._coordinateAt(this.lookAhead));
            this.headingReady = false;

            this.map.easeTo({
                center: start, zoom: FLYOVER_ZOOM, bearing: this.heading,
                pitch: FLYOVER_PITCH, padding: this.padding,
                duration: 1600, easing: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
            });
            this.map.once('moveend', () => {
                if (token !== this._token || this.mode !== 'flyover') return;
                this.headingReady = true;
                this._startLoop();
                if (opts.onStarted) opts.onStarted();
            });
        }

        /**
         * Кружим вокруг маршрута. Маршрут должен стоять в свободной части
         * экрана — её задаёт `padding`, и при повороте камеры сдвиг
         * поворачивается вместе с ней сам.
         */
        startOrbit(route, opts) {
            opts = opts || {};
            if (!route || route.length < 2) return;
            this.stop();

            const pad = opts.padding || { top: 0, right: 0, bottom: 0, left: 0 };
            const box = this.map.getCanvas().getBoundingClientRect();
            const safeWidth = box.width - pad.left - pad.right;
            const safeHeight = box.height - pad.top - pad.bottom;
            if (!(safeWidth > 60 && safeHeight > 60)) return;

            this.padding = pad;
            this.mode = 'orbit';
            this._onFinish = null;
            this.stoppedByUser = false;
            this.orbitRoute = route;
            this.orbitPivot = centroid(route);
            this.orbitBearing = this.map.getBearing();
            this.orbitZoom = this._fitZoom(route, pad, box);
            this._orbitAccumulator = 0;
            const token = ++this._token;

            this.map.easeTo({
                center: this.orbitPivot, zoom: this.orbitZoom,
                bearing: this.orbitBearing, pitch: ORBIT_PITCH, padding: pad,
                duration: 1200
            });
            this.map.once('moveend', () => {
                if (token !== this._token || this.mode !== 'orbit') return;
                this._startLoop();
            });
        }

        /**
         * Один зум на весь оборот — тот, при котором маршрут влезает в кадр
         * при **любом** азимуте.
         *
         * ⚠️ В приложении камера «дышит»: подъезжает ближе там, где маршрут
         * повёрнут вдоль экрана. На вебе от этого пришлось отказаться.
         * Непрерывно меняющийся зум заставляет карту пересчитывать покрытие
         * тайлами на каждом кадре и то и дело пересекать границу уровня:
         * спутниковые тайлы начинали мигать белым, рельеф оставался, а через
         * минуту вращения всё вставало колом (фидбэк 2026-09-18). Постоянный
         * зум — это ровно один набор тайлов на весь оборот.
         */
        _fitZoom(route, pad, box) {
            const fit = new OrbitFit(route, box.width - pad.left - pad.right,
                                            box.height - pad.top - pad.bottom);
            // Если маршрут и так весь в кадре — зум не трогаем вовсе: иначе с
            // приближенного маршрута камера отскакивает на обзор половины страны
            if (this._routeFitsOnScreen(route, pad, box)) return this.map.getZoom();
            let lowest = Infinity;
            for (let d = 0; d < 360; d += 5) lowest = Math.min(lowest, fit.zoomForBearing(d));
            return lowest;
        }

        // MARK: - Пауза

        /**
         * Пауза облёта: карту отдаём человеку целиком — вращать, приближать,
         * ходить по ней. Режим при этом не кончается, карточка профиля
         * остаётся, и по «Продолжить» полёт идёт дальше с того же метра.
         */
        pause() {
            if (this.mode === 'off' || this.paused) return;
            this.paused = true;
            if (this._frame) cancelAnimationFrame(this._frame);
            this._frame = null;
            // Поза на момент паузы: к ней и вернёмся, если карту увели в сторону
            this.pausedCamera = {
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                bearing: this.map.getBearing(),
                pitch: this.map.getPitch()
            };
            if (this.onPauseChange) this.onPauseChange(true);
        }

        /**
         * Продолжить. Если карту за это время увели — сначала возвращаемся в
         * ту же позу, и только потом летим дальше: иначе полёт продолжится
         * где-то за кадром, и непонятно, куда смотреть.
         */
        resume() {
            if (!this.paused || this.mode === 'off') return;
            const pose = this.pausedCamera;
            const token = this._token;
            const go = () => {
                if (token !== this._token || this.mode === 'off') return;
                this.paused = false;
                if (this.onPauseChange) this.onPauseChange(false);
                this._startLoop();
            };
            if (!pose || !this._cameraMoved(pose)) { go(); return; }
            let resumed = false;
            const once = () => { if (!resumed) { resumed = true; go(); } };
            this.map.easeTo({
                center: pose.center, zoom: pose.zoom, bearing: pose.bearing,
                pitch: pose.pitch, padding: this.padding, duration: 900
            });
            this.map.once('moveend', once);
            // Страховка: возврат идёт анимацией, а она не доедет, если вкладку
            // увели в фон — полёт не должен остаться запаузенным навсегда
            setTimeout(once, 1400);
        }

        /** Заметно ли камера уехала от позы, в которой её поставили на паузу */
        _cameraMoved(pose) {
            const center = this.map.getCenter();
            const metres = root.GradeColor.meters([center.lng, center.lat], [pose.center.lng, pose.center.lat]);
            return metres > 25
                || Math.abs(this.map.getZoom() - pose.zoom) > 0.05
                || Math.abs(shortestTurn(this.map.getBearing(), pose.bearing)) > 1
                || Math.abs(this.map.getPitch() - pose.pitch) > 1;
        }

        stop() {
            if (this._frame) cancelAnimationFrame(this._frame);
            this._frame = null;
            if (this._padFrame) cancelAnimationFrame(this._padFrame);
            this._padFrame = null;
            const wasRunning = this.mode !== 'off';
            const onFinish = this._onFinish;
            this.mode = 'off';
            this.paused = false;
            this._onFinish = null;
            this.points = null;
            this.orbitRoute = null;
            this._token++;
            // Интерфейсу нужно знать и про «бросили руками», и про «долетели»
            if (wasRunning && this.onStop) this.onStop();
            return onFinish;
        }

        /**
         * Во сколько раз быстрее базовой скорости. Меняется прямо во время
         * облёта — умножается шаг времени, а не пересчитывается длительность,
         * поэтому камера не прыгает в новую точку.
         */
        setSpeed(value) { this.speed = value; }

        /**
         * Свободная часть экрана изменилась (карточку свернули или вернули).
         *
         * ⚠️ Едем к новому кадру **плавно и ровно столько же**, сколько едет
         * сама карточка: мгновенная подмена `padding` (а у вращения вместе с
         * ним и зума) читалась как рывок карты посреди спокойного движения.
         */
        updatePadding(pad, duration) {
            const ms = duration === undefined ? 450 : duration;
            const from = Object.assign({}, this.padding);
            const fromZoom = this.orbitZoom;
            let toZoom = this.orbitZoom;
            if (this.mode === 'orbit' && this.orbitRoute) {
                const box = this.map.getCanvas().getBoundingClientRect();
                if (box.width - pad.left - pad.right > 60 && box.height - pad.top - pad.bottom > 60) {
                    toZoom = this._fitZoom(this.orbitRoute, pad, box);
                }
            }
            if (this._padFrame) cancelAnimationFrame(this._padFrame);
            if (!(ms > 0)) { this.padding = pad; this.orbitZoom = toZoom; return; }

            const t0 = performance.now();
            // Та же кривая, что у перехода самой карточки в CSS
            const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const step = now => {
                const p = Math.min(1, (now - t0) / ms);
                const e = ease(p);
                this.padding = {
                    top:    from.top    + (pad.top    - from.top)    * e,
                    right:  from.right  + (pad.right  - from.right)  * e,
                    bottom: from.bottom + (pad.bottom - from.bottom) * e,
                    left:   from.left   + (pad.left   - from.left)   * e
                };
                if (fromZoom !== undefined) this.orbitZoom = fromZoom + (toZoom - fromZoom) * e;
                // На паузе покадрового цикла нет — двигаем карту сами
                if (this.paused) this.map.setPadding(this.padding);
                this._padFrame = p < 1 ? requestAnimationFrame(step) : null;
            };
            this._padFrame = requestAnimationFrame(step);
        }

        // MARK: - Покадровое ведение

        _startLoop() {
            if (this._frame) cancelAnimationFrame(this._frame);
            this._lastFrameAt = performance.now();
            const token = this._token;
            const tick = now => {
                if (token !== this._token) return;
                // Потолок на случай ухода вкладки в фон
                const dt = Math.min(0.1, Math.max(0, (now - this._lastFrameAt) / 1000));
                this._lastFrameAt = now;
                if (this.mode === 'flyover') this._stepFlyover(dt);
                else if (this.mode === 'orbit') this._stepOrbit(dt);
                else return;
                if (this.mode !== 'off' && !this.paused && token === this._token) {
                    this._frame = requestAnimationFrame(tick);
                }
            };
            this._frame = requestAnimationFrame(tick);
        }

        _stepFlyover(dt) {
            this.elapsed += dt * Math.max(0.25, this.speed);
            // Кадр обновляем тридцать раз в секунду — как и на вращении.
            // Движение от этого не грубеет (камера идёт медленно), а работы
            // карте вдвое меньше: на спутнике с рельефом это разница между
            // «летит» и «спотыкается».
            this._flyAccumulator = (this._flyAccumulator || 0) + dt;
            if (this._flyAccumulator < 1 / 30 && this.elapsed < this.duration) return;
            this._flyAccumulator = 0;
            const progress = Math.min(1, this.elapsed / this.duration);
            const travelled = progress * this.totalMeters;
            const here = this._coordinateAt(travelled);
            const target = bearing(here, this._coordinateAt(travelled + this.lookAhead));

            // Азимут догоняет тропу, а не повторяет её след в след: сырой
            // азимут между точками трека дёргается на каждом шаге записи, и
            // камера тряслась бы как в руках. Коэффициент по времени, чтобы
            // плавность не зависела от частоты кадров.
            if (this.headingReady) {
                this.heading = normalize(this.heading + shortestTurn(this.heading, target) * Math.min(1, dt * 2));
            } else {
                this.heading = target;
                this.headingReady = true;
            }

            this.map.jumpTo({
                center: here, zoom: FLYOVER_ZOOM, bearing: this.heading,
                pitch: FLYOVER_PITCH, padding: this.padding
            });
            if (this.onProgress) this.onProgress(here, progress, travelled);

            if (progress < 1) return;
            const onFinish = this.stop();
            if (onFinish) onFinish();
        }

        _stepOrbit(dt) {
            this.orbitBearing = normalize(this.orbitBearing + 360 / ORBIT_PERIOD * dt);
            // ⚠️ Кадр обновляем не чаще тридцати раз в секунду. Оборот идёт
            // почти минуту, и на глаз разницы с шестьюдесятью нет, а карта при
            // наклонённой камере на спутнике перерисовывается вдвое реже.
            this._orbitAccumulator += dt;
            if (this._orbitAccumulator < 1 / 30) return;
            this._orbitAccumulator = 0;
            this.map.jumpTo({
                center: this.orbitPivot, zoom: this.orbitZoom,
                bearing: this.orbitBearing, pitch: ORBIT_PITCH, padding: this.padding
            });
        }

        // MARK: - Геометрия трассы

        _cumulativeMeters(route) {
            const out = new Array(route.length).fill(0);
            for (let i = 1; i < route.length; i++) {
                out[i] = out[i - 1] + root.GradeColor.meters(route[i - 1], route[i]);
            }
            return out;
        }

        _coordinateAt(distance) {
            const points = this.points;
            if (distance <= 0) return points[0];
            if (distance >= this.totalMeters) return points[points.length - 1];
            let low = 0, high = this.cumulative.length - 1;
            while (low + 1 < high) {
                const mid = (low + high) >> 1;
                if (this.cumulative[mid] <= distance) low = mid; else high = mid;
            }
            const span = this.cumulative[high] - this.cumulative[low];
            const t = span > 0 ? (distance - this.cumulative[low]) / span : 0;
            return [
                points[low][0] + (points[high][0] - points[low][0]) * t,
                points[low][1] + (points[high][1] - points[low][1]) * t
            ];
        }

        /** Весь ли маршрут сейчас в свободной части кадра */
        _routeFitsOnScreen(route, pad, box) {
            const step = Math.max(1, Math.floor(route.length / 80));
            for (let i = 0; i < route.length; i += step) {
                const p = this.map.project(route[i]);
                if (p.x < pad.left || p.x > box.width - pad.right ||
                    p.y < pad.top || p.y > box.height - pad.bottom) return false;
            }
            return true;
        }
    }

    root.CinematicCamera = CinematicCamera;
    root.CinematicCamera.SPEEDS = SPEEDS;
    root.CinematicCamera.geometry = { bearing, centroid, normalize, shortestTurn, OrbitFit };
})(typeof globalThis !== 'undefined' ? globalThis : window);
