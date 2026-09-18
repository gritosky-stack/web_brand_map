/* ── Профиль высот ────────────────────────────────────────────────────────────
 *
 * Порт `hikingmap/hikingmap/Views/ProfileChart.swift`: один график со всей
 * функциональностью приложения —
 *
 *   • раскраска кривой по уклону теми же цветами, что и линия на карте
 *     (общий расчёт в `grade_color.js`);
 *   • ведение пальцем/мышью — бегунок на карте, высота, километр и участок
 *     постоянного уклона под пальцем;
 *   • выделение участка (двойной тап + протяжка, на десктопе Shift+протяжка) —
 *     подсветка на карте и облёт к нему;
 *   • щипок и протяжка двумя пальцами (на десктопе колесо) — приближение
 *     куска профиля;
 *   • ось X **по расстоянию**, а не по номерам точек: в записанном треке точки
 *     густеют там, где шли медленно, и на «индексной» оси первый километр
 *     растягивался бы на полграфика.
 *
 * Рисуется руками по canvas, а не библиотекой: почти всё содержимое здесь —
 * градиент по уклону, свои засечки, выделение и бегунок, — и ни один из этих
 * кусков через настройки Chart.js не выражается.
 */
(function (root) {
    'use strict';

    const GC = root.GradeColor;

    // ── Участки постоянного уклона ───────────────────────────────────────────
    //
    // Разбиение профиля на участки, внутри которых уклон примерно одинаков —
    // то же, что цветные полосы в brouter.de. Из них берутся «длина участка»
    // и «тип» (средний уклон) в шкале скраба.
    const ProfileBands = {
        // Границы классов уклона: где меняется цвет палитры, там и кончается
        // участок
        classBounds: [-16, -8, -3, 3, 8, 16],
        // Короче этого участок не заводим: на шуме высот профиль иначе
        // распадается на десятки полос по два десятка метров
        minBandMeters: 150,

        classIndex(grade) {
            let index = 0;
            for (const bound of this.classBounds) if (grade >= bound) index++;
            return index;
        },

        /**
         * `pointGrades` — уклон в точках профиля, посчитанный по **полной**
         * геометрии. Считать по прореженным — и есть та ошибка, из-за которой
         * «уклон участка» расходится с цветом под пальцем: на шаге ~90 м окно
         * сглаживания в 60 м ничего не сглаживает.
         */
        build(elevations, distanceKm, pointGrades) {
            if (elevations.length < 2 || distanceKm.length !== elevations.length) return [];

            let grades;
            if (pointGrades && pointGrades.length === elevations.length) {
                // Уклон задан в точках — переводим в отрезки между ними
                grades = new Array(elevations.length - 1);
                for (let i = 0; i < grades.length; i++) {
                    grades[i] = (pointGrades[i] + pointGrades[i + 1]) / 2;
                }
            } else {
                return [];
            }

            const starts = [0];
            for (let i = 1; i < grades.length; i++) {
                if (this.classIndex(grades[i]) !== this.classIndex(grades[i - 1])) starts.push(i);
            }

            // Слишком короткие куски прирастают к предыдущему
            const merged = [0];
            for (const start of starts.slice(1)) {
                const previous = merged[merged.length - 1];
                if ((distanceKm[start] - distanceKm[previous]) * 1000 >= this.minBandMeters) merged.push(start);
            }
            const lastPoint = elevations.length - 1;
            if (merged.length > 1) {
                const previous = merged[merged.length - 1];
                if ((distanceKm[lastPoint] - distanceKm[previous]) * 1000 < this.minBandMeters) merged.pop();
            }

            return merged.map((start, position) => {
                const end = position + 1 < merged.length ? merged[position + 1] : lastPoint;
                const km = Math.max(0, distanceKm[end] - distanceKm[start]);
                const dh = elevations[end] - elevations[start];
                return { from: start, to: end, km, gradePercent: km > 0 ? dh / (km * 1000) * 100 : 0 };
            });
        },

        /** Для каждой точки профиля — номер её участка */
        indexMap(bands, pointCount) {
            const map = new Array(pointCount).fill(0);
            bands.forEach((band, i) => {
                for (let p = band.from; p <= band.to && p < pointCount; p++) map[p] = i;
            });
            return map;
        },

        /** «+16%» / «−4%» / «0%» */
        gradeLabel(percent) {
            const rounded = Math.round(percent);
            if (Math.abs(rounded) < 0.5) return '0%';
            return (rounded > 0 ? '+' : '−') + Math.abs(rounded) + '%';
        },

        /** «0.7 км» для длинного участка, «320 м» для короткого */
        lengthLabel(km) {
            return km >= 1 ? `${km.toFixed(1)} км` : `${Math.round(km * 1000)} м`;
        }
    };

    // ── Распознавание тапов и ведения ────────────────────────────────────────
    // С какого сдвига касание считается ведением. Пока палец не проехал
    // столько, касание остаётся неопределённым: оно вполне может быть первым
    // тапом из двойного.
    const SCRUB_SLOP = 12;
    const DOUBLE_TAP_MS = 400;
    const DOUBLE_TAP_PX = 44;

    const TEXT_SECONDARY = 'rgba(255,255,255,.55)';

    class ProfileChart {
        /**
         * @param {HTMLElement} container куда рисовать
         * @param {Object} opts
         *   profile  {km[], ele[], lon[], lat[], grade[]} — прореженный профиль,
         *            километры и уклон посчитаны по полной геометрии
         *   stops    узлы раскраски по уклону (GradeColor.gradeStops)
         *   totalKm  полная длина маршрута
         *   accent   акцентный цвет карточки
         *   onScrub(info|null), onSelect(range|null)
         *   interactive  false — график только показывает (его ведёт облёт),
         *                жесты и шапка не нужны
         *   height   высота холста в пикселях
         */
        constructor(container, opts) {
            this.el = container;
            this.accent = opts.accent || '#ff4d4d';
            this.onScrub = opts.onScrub || function () {};
            this.onSelect = opts.onSelect || function () {};
            this.interactive = opts.interactive !== false;
            this.height = opts.height || 132;

            const p = opts.profile || {};
            this.km = p.km || [];
            this.ele = p.ele || [];
            this.lon = p.lon || [];
            this.lat = p.lat || [];
            this.grade = p.grade || [];
            this.stops = opts.stops || [];
            this.totalKm = opts.totalKm || this.km[this.km.length - 1] || 0;

            this.peak = this.ele.length ? Math.max(...this.ele) : 0;
            this.bottom = this.ele.length ? Math.min(...this.ele) : 0;
            this.minY = Math.floor((this.bottom - 80) / 100) * 100;
            this.maxY = Math.ceil((this.peak + 80) / 100) * 100;

            this.bands = ProfileBands.build(this.ele, this.km, this.grade);
            this.bandOfIndex = ProfileBands.indexMap(this.bands, this.ele.length);

            this.scrubIndex = null;
            this.selection = null;          // [lo, hi] в индексах профиля
            this.visible = null;            // [lo, hi] после щипка; null — весь маршрут
            this.dragKind = null;           // 'scrub' | 'select' | null (ещё не решили)
            this.lastTap = null;
            this.plot = { x: 0, y: 0, w: 0, h: 0 };

            this.buildDOM();
            if (this.interactive) this.bindEvents();
            this.resize();
        }

        // MARK: - Разметка

        buildDOM() {
            if (!this.interactive) {
                // График облёта: шапка и подсказка живут в самой карточке,
                // а холст занимает её целиком
                this.el.innerHTML =
                    `<canvas class="pc-canvas" style="width:100%;height:${this.height}px;display:block"></canvas>`;
                this.canvas = this.el.querySelector('.pc-canvas');
                this.ctx = this.canvas.getContext('2d');
                this._onResize = () => this.resize();
                window.addEventListener('resize', this._onResize);
                return;
            }
            this.el.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-1.5 text-[11px]" style="color:${this.accent}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 6l-4.22 5.63 1.25 1.67L14 9.33 19 16h-8.46l-4.01-5.37L1 18h22L14 6zM5 16l1.52-2.03L8.04 16H5z"/></svg>
                        <span class="tabular-nums">${Math.round(this.peak)} м</span>
                    </div>
                    <div id="pc-readout" class="text-[11px] tabular-nums" style="color:${TEXT_SECONDARY}">Мин ${Math.round(this.bottom)} м</div>
                </div>
                <canvas class="pc-canvas" style="width:100%;height:${this.height}px;display:block;touch-action:none;cursor:crosshair"></canvas>
                <div class="pc-hint"></div>`;
            this.canvas = this.el.querySelector('.pc-canvas');
            this.readout = this.el.querySelector('#pc-readout');
            this.hint = this.el.querySelector('.pc-hint');
            this.ctx = this.canvas.getContext('2d');
            this.updateHint();
        }

        destroy() {
            window.removeEventListener('resize', this._onResize);
            window.removeEventListener('mouseup', this._onMouseUp);
            this.el.innerHTML = '';
        }

        // MARK: - Геометрия графика

        get range() { return this.visible || [0, Math.max(this.ele.length - 1, 0)]; }
        get fullRange() { return [0, Math.max(this.ele.length - 1, 0)]; }
        get fullKm() { return this.km[this.km.length - 1] || 0; }

        /**
         * Домен оси X — километры видимого куска. Ось идёт по расстоянию:
         * засечка «5» обязана совпадать с тем, что показывает шкала под пальцем.
         */
        get kmDomain() {
            const [lo, hi] = this.range;
            const from = this.km[lo] || 0;
            const to = this.km[hi] || 0;
            return to > from ? [from, to] : [from, from + 1];
        }

        get yStride() {
            const range = this.maxY - this.minY;
            if (range < 300) return 100;
            if (range < 700) return 200;
            return 300;
        }

        xForKm(km) {
            const [from, to] = this.kmDomain;
            return this.plot.x + (km - from) / (to - from) * this.plot.w;
        }
        kmForX(x) {
            const [from, to] = this.kmDomain;
            return from + (x - this.plot.x) / this.plot.w * (to - from);
        }
        yForEle(ele) {
            return this.plot.y + (1 - (ele - this.minY) / (this.maxY - this.minY)) * this.plot.h;
        }

        /** Ближайшая точка видимого куска к заданному километру */
        indexForKm(target) {
            const [lo, hi] = this.range;
            if (hi <= lo) return null;
            // За краями графика тянем к его концам, а не бросаем жест
            if (target <= this.km[lo]) return lo;
            if (target >= this.km[hi]) return hi;
            let a = lo, b = hi;
            while (a < b) {
                const mid = (a + b) >> 1;
                if (this.km[mid] < target) a = mid + 1; else b = mid;
            }
            if (a > lo && Math.abs(this.km[a - 1] - target) < Math.abs(this.km[a] - target)) return a - 1;
            return a;
        }

        /** Точка профиля по километру — по всему маршруту, без оглядки на окно */
        indexInFull(target) {
            if (this.km.length < 2) return 0;
            if (target <= this.km[0]) return 0;
            const last = this.km.length - 1;
            if (target >= this.km[last]) return last;
            let a = 0, b = last;
            while (a < b) {
                const mid = (a + b) >> 1;
                if (this.km[mid] < target) a = mid + 1; else b = mid;
            }
            if (a > 0 && Math.abs(this.km[a - 1] - target) < Math.abs(this.km[a] - target)) return a - 1;
            return a;
        }

        // MARK: - Отрисовка

        resize() {
            const dpr = window.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();
            if (!rect.width) return;
            this.canvas.width = Math.round(rect.width * dpr);
            this.canvas.height = Math.round(rect.height * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.css = { w: rect.width, h: rect.height };
            // Подписи высот стоят справа, подписи километров — снизу
            this.plot = { x: 2, y: 8, w: rect.width - 40, h: rect.height - 22 };
            this.draw();
        }

        draw() {
            const ctx = this.ctx;
            if (!this.css) return;
            ctx.clearRect(0, 0, this.css.w, this.css.h);
            if (this.ele.length < 2) return;

            const [lo, hi] = this.range;
            const stops = this.windowStops();
            if (this._hintForWindow !== !!this.visible) {
                this._hintForWindow = !!this.visible;
                this.updateHint();
            }

            this.drawYAxis(ctx);
            this.drawXAxis(ctx);

            // Выделенный участок — подложкой под кривой
            if (this.selection) {
                const x0 = this.xForKm(this.km[this.selection[0]]);
                const x1 = this.xForKm(this.km[this.selection[1]]);
                ctx.fillStyle = 'rgba(255,255,255,0.12)';
                ctx.fillRect(Math.min(x0, x1), this.plot.y, Math.abs(x1 - x0), this.plot.h);
            }

            // Заливка под кривой и сама кривая — одним и тем же градиентом по
            // уклону, только с разной прозрачностью
            const path = new Path2D();
            for (let i = lo; i <= hi; i++) {
                const x = this.xForKm(this.km[i]);
                const y = this.yForEle(this.ele[i]);
                if (i === lo) path.moveTo(x, y); else path.lineTo(x, y);
            }
            const area = new Path2D(path);
            area.lineTo(this.xForKm(this.km[hi]), this.plot.y + this.plot.h);
            area.lineTo(this.xForKm(this.km[lo]), this.plot.y + this.plot.h);
            area.closePath();

            const x0 = this.xForKm(this.kmDomain[0]);
            const x1 = this.xForKm(this.kmDomain[1]);
            ctx.fillStyle = GC.canvasGradient(ctx, x0, x1, stops, 0.4) || this.accent;
            ctx.fill(area);

            ctx.strokeStyle = GC.canvasGradient(ctx, x0, x1, stops, 1) || this.accent;
            ctx.lineWidth = 2.4;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke(path);

            if (this.selection) this.drawSelectionEdges(ctx);
            if (this.scrubIndex !== null) this.drawScrub(ctx);
            else this.drawEndLabel(ctx);
        }

        /**
         * Подсказка под графиком. Пока смотрят кусок маршрута, она уступает
         * место возврату: догадаться, что «весь маршрут» возвращается двойным
         * кликом, неоткуда.
         */
        updateHint() {
            if (!this.hint || !this.interactive) return;
            if (this.visible) {
                this.hint.innerHTML = '<button class="pc-reset" type="button">↔ Весь маршрут</button>';
                this.hint.querySelector('.pc-reset').addEventListener('click', () => {
                    this.releaseSelection();
                    this.resetWindow();
                });
            } else {
                this.hint.textContent = 'Ведите по графику · Shift + протяжка или двойной тап — участок · '
                                      + 'колесо / щипок — приблизить';
            }
        }

        /** Узлы раскраски, обрезанные по видимому куску */
        windowStops() {
            if (!this.visible || !this.totalKm) return this.stops;
            const [lo, hi] = this.range;
            return GC.windowedStops(this.stops, this.km[lo] / this.totalKm, this.km[hi] / this.totalKm);
        }

        /**
         * Обычная сетка плюс отдельная полка на самой высокой точке маршрута —
         * её подпись показывает пик, а не круглую сотню метров рядом.
         */
        drawYAxis(ctx) {
            const values = [];
            for (let v = this.minY; v <= this.maxY; v += this.yStride) {
                // Круглая линия впритык к пику не нужна: две подписи слипнутся
                if (Math.abs(v - this.peak) > this.yStride * 0.4) values.push(v);
            }
            values.push(this.peak);

            ctx.save();
            ctx.font = '9px system-ui,-apple-system,sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const v of values) {
                const isPeak = Math.abs(v - this.peak) < 0.001;
                const y = this.yForEle(v);
                if (y < this.plot.y - 2 || y > this.plot.y + this.plot.h + 2) continue;
                ctx.beginPath();
                ctx.setLineDash(isPeak ? [] : [4, 4]);
                ctx.lineWidth = isPeak ? 0.9 : 0.5;
                ctx.strokeStyle = isPeak ? this.accent + '8c' : 'rgba(255,255,255,0.12)';
                ctx.moveTo(this.plot.x, y);
                ctx.lineTo(this.plot.x + this.plot.w, y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = isPeak ? this.accent : TEXT_SECONDARY;
                ctx.fillText(`${Math.round(v)}м`, this.plot.x + this.plot.w + 4, y);
            }
            ctx.restore();
        }

        /**
         * Засечки — «круглые» километры из лестницы, до восьми на видимый кусок.
         *
         * ⚠️ Левый конец подписан всегда, правый рисуется отдельно
         * (`drawEndLabel`) полной дистанцией маршрута: без них ось обрывалась
         * на последней круглой засечке, и сравнить график с дистанцией из
         * шапки карточки было не с чем.
         */
        drawXAxis(ctx) {
            const [from, to] = this.kmDomain;
            const span = to - from;
            if (!(span > 0)) return;

            const ladder = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50, 100];
            const step = ladder.find(s => span / s <= 8) || ladder[ladder.length - 1];

            // Круглая засечка вплотную к краю или к бегунку сливается с их
            // подписями — такую пропускаем, концы важнее. У правого конца
            // зазор вдвое шире: там стоит подпись полной дистанции.
            const margin = span * 0.075;
            const endMargin = span * 0.15;
            const scrubKm = this.scrubIndex !== null ? this.km[this.scrubIndex] : null;

            const ticks = [from];
            for (let v = Math.ceil(from / step) * step; v <= to; v += step) {
                const clearOfEnds = v > from + margin && v < to - endMargin;
                const clearOfScrub = scrubKm === null || Math.abs(v - scrubKm) > margin;
                if (clearOfEnds && clearOfScrub) ticks.push(v);
            }

            ctx.save();
            ctx.font = '9px system-ui,-apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (const tick of ticks) {
                const x = this.xForKm(tick);
                ctx.beginPath();
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 0.5;
                ctx.strokeStyle = 'rgba(255,255,255,0.10)';
                ctx.moveTo(x, this.plot.y);
                ctx.lineTo(x, this.plot.y + this.plot.h);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = TEXT_SECONDARY;
                // Крайняя засечка стоит на самом краю графика, и подпись под
                // ней наполовину уезжала за холст — прижимаем её внутрь
                const label = this.xTickLabel(tick);
                const half = ctx.measureText(label).width / 2;
                const lx = Math.max(this.plot.x + half,
                                    Math.min(this.plot.x + this.plot.w - half, x));
                ctx.fillText(label, lx, this.plot.y + this.plot.h + 4);
            }
            ctx.restore();
        }

        xTickLabel(km) {
            return Math.abs(km - Math.round(km)) < 0.05 ? String(Math.round(km)) : km.toFixed(1);
        }

        /**
         * Полная дистанция маршрута у правого конца оси. Во время ведения
         * уступает место бегунку — два числа рядом сливаются.
         */
        drawEndLabel(ctx) {
            if (this.visible || !(this.totalKm > 0)) return;
            ctx.save();
            ctx.font = '500 9px system-ui,-apple-system,sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillStyle = TEXT_SECONDARY;
            ctx.fillText(this.totalKm.toFixed(1), this.plot.x + this.plot.w, this.plot.y + this.plot.h + 4);
            ctx.restore();
        }

        drawSelectionEdges(ctx) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            for (const idx of this.selection) {
                const x = this.xForKm(this.km[idx]);
                ctx.beginPath();
                ctx.moveTo(x, this.plot.y);
                ctx.lineTo(x, this.plot.y + this.plot.h);
                ctx.stroke();
            }
            ctx.restore();
        }

        /**
         * Бегунок: пунктир, точка на кривой и километр под пальцем подписью
         * прямо на оси X.
         *
         * ⚠️ Ради последнего всё и затевалось: пока дистанция жила только в
         * шкале наверху экрана, пунктир на «10.8» глазом ложился на засечку
         * «10», и ось выглядела врущей.
         */
        drawScrub(ctx) {
            const i = this.scrubIndex;
            const x = this.xForKm(this.km[i]);
            const y = this.yForEle(this.ele[i]);

            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, this.plot.y);
            ctx.lineTo(x, this.plot.y + this.plot.h);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(x, y, 4.2, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.shadowColor = 'rgba(0,0,0,.6)';
            ctx.shadowBlur = 4;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Километр под пальцем — подписью на оси, в цвете акцента
            const label = this.km[i].toFixed(1);
            ctx.font = '600 9px system-ui,-apple-system,sans-serif';
            const w = ctx.measureText(label).width + 8;
            const lx = Math.max(this.plot.x, Math.min(this.plot.x + this.plot.w - w, x - w / 2));
            const ly = this.plot.y + this.plot.h + 3;
            ctx.fillStyle = this.accent + 'd9';
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lx, ly, w, 13, 3); ctx.fill(); }
            else ctx.fillRect(lx, ly, w, 13);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, lx + w / 2, ly + 7);
            ctx.restore();
        }

        // MARK: - Шапка

        updateReadout() {
            if (!this.readout) return;
            if (this.selection) {
                const [a, b] = this.selection;
                const km = Math.max(0, this.km[b] - this.km[a]);
                const dh = this.ele[b] - this.ele[a];
                const grade = km > 0 ? dh / (km * 1000) * 100 : 0;
                this.readout.innerHTML =
                    `<span class="pc-chip"><span>${ProfileBands.lengthLabel(km)}</span>` +
                    `<span style="color:${GC.cssForGrade(grade)}">${ProfileBands.gradeLabel(grade)}</span></span>`;
                return;
            }
            if (this.scrubIndex !== null) {
                this.readout.innerHTML =
                    `<span class="pc-chip" style="background:${this.accent}40;color:#fff">` +
                    `${Math.round(this.ele[this.scrubIndex])} м</span>`;
                return;
            }
            this.readout.innerHTML = `Мин ${Math.round(this.bottom)} м`;
        }

        // MARK: - Внешний курсор (облёт)

        /**
         * Поставить бегунок на заданный километр, ничего никуда не публикуя:
         * графиком в этот момент управляет облёт, а не палец. Возвращает то
         * же, что публикует ведение, — карточке облёта есть что показать.
         */
        setCursor(km) {
            if (this.ele.length < 2) return null;
            const index = this.indexInFull(km);
            if (index === this.scrubIndex) return this.infoAt(index);
            this.scrubIndex = index;
            this.updateReadout();
            this.draw();
            return this.infoAt(index);
        }

        clearCursor() {
            if (this.scrubIndex === null) return;
            this.scrubIndex = null;
            this.updateReadout();
            this.draw();
        }

        /** Высота, километр и участок постоянного уклона в точке профиля */
        infoAt(index) {
            const band = this.bands[this.bandOfIndex[index]];
            return {
                index,
                km: this.km[index],
                totalKm: this.totalKm,
                elevation: this.ele[index],
                lngLat: [this.lon[index], this.lat[index]],
                segmentKm: band ? band.km : null,
                segmentGrade: band ? band.gradePercent : null
            };
        }

        // MARK: - Публикация наружу

        publishScrub(index) {
            this.onScrub(this.infoAt(index));
        }

        endScrub() {
            this.scrubIndex = null;
            this.updateReadout();
            this.draw();
            this.onScrub(null);
        }

        /**
         * Выделили участок — просим карту подсветить его и облететь.
         * Подсветку отдаём **долями пройденного пути**, а не координатами:
         * прореженные координаты на поворотах уходят в сторону от тропы, а
         * километры посчитаны по полной геометрии и попадают точно.
         */
        publishSelection() {
            if (!this.selection) { this.onSelect(null); return; }
            const [a, b] = this.selection;
            if (b <= a) { this.onSelect(null); return; }
            const coords = [];
            for (let i = a; i <= b; i++) coords.push([this.lon[i], this.lat[i]]);
            this.onSelect({
                fromKm: this.km[a],
                toKm: this.km[b],
                fromFraction: this.totalKm > 0 ? this.km[a] / this.totalKm : 0,
                toFraction: this.totalKm > 0 ? this.km[b] / this.totalKm : 1,
                coordinates: coords
            });
        }

        releaseSelection() {
            if (!this.selection) return;
            this.selection = null;
            this.updateReadout();
            this.onSelect(null);
        }

        // MARK: - Окно (щипок / колесо)

        /**
         * Уже километры, чем это, не показываем: дальше на экране остаются
         * считанные точки профиля и растянутый шум высот. Привязано к длине
         * маршрута: на трёхкилометровой прогулке и на сорокакилометровом
         * переходе «слишком близко» — разное.
         */
        get minWindowKm() { return Math.max(0.15, this.fullKm / 60); }

        setWindow(fromKm, toKm) {
            const total = this.fullKm;
            if (!(total > 0)) return;
            let width = Math.min(total, Math.max(this.minWindowKm, toKm - fromKm));
            let lower = Math.max(0, fromKm);
            if (lower + width > total) lower = total - width;
            if (lower < 0) { lower = 0; width = total; }

            // Развернули почти на весь маршрут — считаем, что вернулись к
            // полному виду: ось и раскраска снова считаются без обрезки
            if (width >= total - 0.0001) { this.visible = null; this.draw(); return; }

            const lo = this.indexInFull(lower);
            const hi = this.indexInFull(lower + width);
            if (lo >= hi) return;
            this.visible = [lo, hi];
            this.draw();
        }

        /** Приблизить вокруг точки под курсором/пальцами */
        zoomBy(factor, anchorFraction) {
            const [from, to] = this.kmDomain;
            const width = to - from;
            const newWidth = Math.min(this.fullKm, Math.max(this.minWindowKm, width / factor));
            const anchorKm = from + width * anchorFraction;
            const start = anchorKm - newWidth * anchorFraction;
            this.setWindow(start, start + newWidth);
        }

        panBy(dxPixels) {
            if (!this.visible || !this.plot.w) return;
            const [from, to] = this.kmDomain;
            const width = to - from;
            // Пальцы идут влево — окно едет вправо, как при прокрутке ленты
            const shift = -dxPixels / this.plot.w * width;
            this.setWindow(from + shift, to + shift);
        }

        resetWindow() {
            if (!this.visible) return;
            this.visible = null;
            this.draw();
        }

        // MARK: - Жесты

        localPoint(e) {
            const rect = this.canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        indexAt(point) {
            return this.indexForKm(this.kmForX(point.x));
        }

        scrubTo(point) {
            const index = this.indexAt(point);
            if (index === null) return;
            // Ушли за пределы выделенного участка — значит смотрим уже не на
            // него: снимаем выделение и отпускаем кадр карты
            if (this.selection && (index < this.selection[0] || index > this.selection[1])) {
                this.releaseSelection();
            }
            this.scrubIndex = index;
            this.updateReadout();
            this.draw();
            this.publishScrub(index);
        }

        selectTo(startPoint, point) {
            const a = this.indexAt(startPoint);
            const b = this.indexAt(point);
            if (a === null || b === null) return;
            this.selection = [Math.min(a, b), Math.max(a, b)];
            this.updateReadout();
            this.draw();
        }

        bindEvents() {
            const canvas = this.canvas;

            this._onResize = () => this.resize();
            window.addEventListener('resize', this._onResize);

            // ── Мышь: наведение ведёт бегунок, Shift + протяжка выделяет участок
            let mouseDown = null;
            canvas.addEventListener('mousemove', e => {
                const point = this.localPoint(e);
                if (mouseDown && (e.shiftKey || this.dragKind === 'select')) {
                    this.dragKind = 'select';
                    this.selectTo(mouseDown, point);
                } else {
                    this.scrubTo(point);
                }
            });
            canvas.addEventListener('mousedown', e => {
                mouseDown = this.localPoint(e);
                if (e.shiftKey) {
                    this.dragKind = 'select';
                    this.releaseSelection();
                }
                e.preventDefault();
            });
            // Отпустить кнопку можно и за пределами графика, поэтому слушаем
            // окно — и снимаем слушателя в `destroy`, иначе на каждый
            // открытый маршрут копился бы ещё один, держащий мёртвый график
            this._onMouseUp = () => {
                if (this.dragKind === 'select' && this.selection) this.publishSelection();
                mouseDown = null;
                this.dragKind = null;
            };
            window.addEventListener('mouseup', this._onMouseUp);
            canvas.addEventListener('mouseleave', () => {
                if (this.dragKind !== 'select') this.endScrub();
            });

            // Колесо — приближение вокруг курсора; двойной клик — обратно к
            // полному виду вместе со снятым выделением
            canvas.addEventListener('wheel', e => {
                e.preventDefault();
                const point = this.localPoint(e);
                const fraction = Math.min(1, Math.max(0, (point.x - this.plot.x) / this.plot.w));
                this.zoomBy(Math.exp(-e.deltaY * 0.0025), fraction);
            }, { passive: false });
            canvas.addEventListener('dblclick', () => {
                this.releaseSelection();
                this.resetWindow();
            });

            // ── Касания: один палец — ведение (двойной тап и протяжка —
            // выделение), два пальца — щипок и протяжка окна
            let touchStart = null, pinch = null;
            canvas.addEventListener('touchstart', e => {
                if (e.touches.length >= 2) {
                    // Второй палец лёг на график — ведение прекращаем: иначе на
                    // карте остаётся висеть бегунок от касания, которое уже
                    // стало щипком
                    if (this.scrubIndex !== null) this.endScrub();
                    this.dragKind = null;
                    pinch = this.pinchState(e);
                    e.preventDefault();
                    return;
                }
                const point = this.localPoint(e.touches[0]);
                touchStart = { point, time: Date.now() };
                this.dragKind = ProfileChart.isSecondTap(this.lastTap, point) ? 'select' : null;
                if (this.dragKind === 'select') this.releaseSelection();
                e.preventDefault();
            }, { passive: false });

            canvas.addEventListener('touchmove', e => {
                if (e.touches.length >= 2 && pinch) {
                    const now = this.pinchState(e);
                    const factor = now.spread / pinch.spread;
                    const fraction = Math.min(1, Math.max(0, (pinch.center - this.plot.x) / this.plot.w));
                    this.zoomBy(factor, fraction);
                    this.panBy(now.center - pinch.center);
                    pinch = now;
                    e.preventDefault();
                    return;
                }
                if (!touchStart || !e.touches.length) return;
                const point = this.localPoint(e.touches[0]);
                const moved = Math.hypot(point.x - touchStart.point.x, point.y - touchStart.point.y);
                // Пока палец не проехал `SCRUB_SLOP`, касание считается
                // неопределённым и ничего не публикует: иначе первый тап из
                // двойного успевал сойти за ведение и уводил камеру
                if (this.dragKind === null && moved < SCRUB_SLOP) return;
                if (this.dragKind === null) this.dragKind = 'scrub';
                if (this.dragKind === 'select') this.selectTo(touchStart.point, point);
                else this.scrubTo(point);
                e.preventDefault();
            }, { passive: false });

            const endTouch = e => {
                if (pinch && e.touches.length < 2) pinch = null;
                if (e.touches.length) return;
                if (this.dragKind === 'select') {
                    this.lastTap = null;
                    if (this.selection) {
                        if (navigator.vibrate) navigator.vibrate(8);
                        this.publishSelection();
                    }
                } else if (this.dragKind === 'scrub') {
                    this.endScrub();
                    this.lastTap = touchStart ? { time: Date.now(), point: touchStart.point } : null;
                } else if (touchStart) {
                    // Касание так и осталось тапом — от него ждём второго
                    this.lastTap = { time: Date.now(), point: touchStart.point };
                }
                touchStart = null;
                this.dragKind = null;
            };
            canvas.addEventListener('touchend', endTouch);
            canvas.addEventListener('touchcancel', endTouch);
        }

        pinchState(e) {
            const a = this.localPoint(e.touches[0]);
            const b = this.localPoint(e.touches[1]);
            return { spread: Math.max(1, Math.abs(a.x - b.x)), center: (a.x + b.x) / 2 };
        }

        static isSecondTap(previous, point) {
            if (!previous) return false;
            if (Date.now() - previous.time > DOUBLE_TAP_MS) return false;
            return Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < DOUBLE_TAP_PX;
        }
    }

    root.ProfileChart = ProfileChart;
    root.ProfileBands = ProfileBands;
})(typeof globalThis !== 'undefined' ? globalThis : window);
