/* ── Планирование времени ─────────────────────────────────────────────────────
 *
 * Порт `HikingTime.swift` (модель) и `SmartTimeView.swift` (интерфейс) из
 * приложения.
 *
 * Модель наизмитовская — километры плюс набор высоты, — но коэффициенты не
 * книжные, а подобранные по пройденным трекам: 14 записей из www/*.gpx с
 * настоящими временными метками. Классические 5 км/ч + 1 минута на 10 м
 * набора ошибались на этих треках в среднем на 35 % (два часа на дневном
 * маршруте). Подобранные — на 14 %.
 *
 * Два уточнения, без которых числа не переносятся:
 *  - это **общее** время от старта до финиша, с привалами и фотостопами,
 *    а не чистое ходовое;
 *  - набор берётся тот, что считает parseGPX — после фильтра выбросов и
 *    сглаживания окном 15 точек. По сырым точкам набор в полтора раза
 *    больше, и коэффициент к нему уже не подходит.
 */
(function (root) {
    'use strict';

    // Ровная скорость. Взята круглой: свободная подгонка давала 4.85 км/ч при
    // ровно той же ошибке, а круглое число не создаёт ложного впечатления,
    // будто коэффициент известен до сотых.
    const FLAT_SPEED_KMH = 4.5;
    // Метров набора на минуту. У Наизмита здесь 10 м, но у него и время
    // чистое ходовое, и набор по сырому профилю.
    const METERS_PER_MINUTE_OF_CLIMB = 4.3;

    function minutes(distanceKm, ascentM) {
        if (!(distanceKm > 0) && !(ascentM > 0)) return 0;
        return distanceKm / FLAT_SPEED_KMH * 60 + ascentM / METERS_PER_MINUTE_OF_CLIMB;
    }

    /** «6ч 20м» или «45м» */
    function format(mins) {
        const m = Math.round(mins);
        if (m < 60) return `${m}м`;
        return `${Math.floor(m / 60)}ч ${String(m % 60).padStart(2, '0')}м`;
    }

    const FITNESS = [
        { icon: '🧒', label: 'Новичок', mult: 1.4 },
        { icon: '🧗', label: 'Средний', mult: 1.0 },
        { icon: '⚡', label: 'Профи',   mult: 0.72 }
    ];
    const WEATHER = [
        { icon: '☀️', label: 'Ясно',    mult: 1.0 },
        { icon: '⛅', label: 'Облачно', mult: 1.05 },
        { icon: '🌧', label: 'Дождь',   mult: 1.25 },
        { icon: '❄️', label: 'Снег',    mult: 1.45 }
    ];

    /**
     * Перелистывание цифр — как `contentTransition(.numericText())` в
     * приложении. Меняются только те позиции, которые действительно стали
     * другими: старая цифра уезжает, новая приезжает ей на смену, и сторона
     * зависит от того, выросло значение или упало.
     *
     * ⚠️ Числа набраны моноширинно (`tabular-nums`), иначе ячейка с уходящей
     * цифрой и приходящей были бы разной ширины и строка дёргалась бы.
     */
    function setTicker(el, text, growing) {
        const previous = el.dataset.tick || '';
        if (previous === text) return;
        el.dataset.tick = text;

        // Первая отрисовка — без анимации: анимировать «появление» нечему
        if (!previous) { el.textContent = text; return; }

        const direction = growing ? 'tk-up' : 'tk-down';
        // Длительность анимации из CSS: после неё уехавшие цифры убираем из
        // разметки — иначе они остаются в тексте («7ч 19м» читалось бы как
        // «47ч 149м» в выделении и для скринридера)
        clearTimeout(el._tickTimer);
        el._tickTimer = setTimeout(() => {
            if (el.dataset.tick === text) el.textContent = text;
        }, 420 + text.length * 18);
        // Выравниваем по правому краю: у «8ч 08м» и «10ч 09м» разная длина, и
        // при выравнивании по левому «перелистывались» бы все разряды разом
        const shift = text.length - previous.length;
        el.innerHTML = [...text].map((ch, i) => {
            const before = previous[i - shift];
            if (before === ch) return `<span class="tk-cell">${ch}</span>`;
            const out = before === undefined ? '' : `<span class="tk-out">${before}</span>`;
            return `<span class="tk-cell ${direction}" style="animation-delay:${i * 18}ms">` +
                   `${out}<span class="tk-in">${ch}</span></span>`;
        }).join('');
    }

    function groupMultiplier(n) {
        if (n <= 2) return 1.0;
        if (n <= 5) return 1.0 + (n - 2) * 0.04;
        return 1.15 + (n - 5) * 0.06;
    }

    /**
     * Планировщик времени в панели маршрута. Настройки (состав группы,
     * уровень, погода) переживают смену маршрута и перезагрузку страницы:
     * человек описывает ими себя, а не маршрут, и переставлять их на каждой
     * карточке заново незачем.
     */
    class TimePlanner {
        constructor(container) {
            this.el = container;
            this.state = TimePlanner.loadState();
            this.base = 0;
            this.render();
        }

        static loadState() {
            const fallback = { group: 3, fitness: 1, weather: 0 };
            try {
                const saved = JSON.parse(localStorage.getItem('tw.timePlanner') || 'null');
                if (!saved) return fallback;
                return {
                    group: Math.min(12, Math.max(1, +saved.group || 3)),
                    fitness: FITNESS[saved.fitness] ? +saved.fitness : 1,
                    weather: WEATHER[saved.weather] ? +saved.weather : 0
                };
            } catch (e) { return fallback; }
        }

        saveState() {
            try { localStorage.setItem('tw.timePlanner', JSON.stringify(this.state)); } catch (e) {}
        }

        /** Новый маршрут: база — общая для приложения оценка на одного среднего человека */
        setRoute(distanceKm, ascentM) {
            this.base = minutes(distanceKm, ascentM);
            // Открыли другой маршрут — это не «время изменилось», а новое
            // число: перелистывать с чужого нечего
            const totalEl = this.el.querySelector('#tw-time-total');
            const deltaEl = this.el.querySelector('#tw-time-delta');
            if (totalEl) delete totalEl.dataset.tick;
            if (deltaEl) delete deltaEl.dataset.tick;
            this._lastTotal = undefined;
            this.update();
        }

        get totalMinutes() {
            return Math.round(this.base
                * FITNESS[this.state.fitness].mult
                * WEATHER[this.state.weather].mult
                * groupMultiplier(this.state.group));
        }

        render() {
            const opt = (list, kind, idx) => list.map((o, i) => `
                <button class="tw-chip${i === idx ? ' active' : ''}" data-kind="${kind}" data-idx="${i}">
                    <span class="tw-chip-icon">${o.icon}</span>
                    <span class="tw-chip-label">${o.label}</span>
                </button>`).join('');

            this.el.innerHTML = `
                <div class="flex items-baseline gap-2 mb-3">
                    <div id="tw-time-total" class="text-[30px] font-bold text-white tabular-nums leading-none">—</div>
                    <div id="tw-time-delta" class="text-[11px] font-semibold tabular-nums"></div>
                </div>
                <div class="border-t border-zinc-800/80 pt-3 mb-3">
                    <div class="flex items-center justify-between mb-2">
                        <div class="tw-section-label">Группа</div>
                        <div id="tw-group-value" class="text-[13px] font-bold text-white tabular-nums"></div>
                    </div>
                    <input id="tw-group" type="range" min="1" max="12" step="1" class="tw-range">
                </div>
                <div class="mb-3">
                    <div class="tw-section-label mb-2">Уровень группы</div>
                    <div class="grid grid-cols-3 gap-2">${opt(FITNESS, 'fitness', this.state.fitness)}</div>
                </div>
                <div>
                    <div class="tw-section-label mb-2">Погода</div>
                    <div class="grid grid-cols-4 gap-2">${opt(WEATHER, 'weather', this.state.weather)}</div>
                </div>`;

            const slider = this.el.querySelector('#tw-group');
            slider.value = this.state.group;
            slider.addEventListener('input', () => {
                this.state.group = +slider.value;
                this.saveState();
                this.update();
            });

            this.el.querySelectorAll('.tw-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const kind = btn.dataset.kind;
                    this.state[kind] = +btn.dataset.idx;
                    this.saveState();
                    this.el.querySelectorAll(`.tw-chip[data-kind="${kind}"]`)
                        .forEach(b => b.classList.toggle('active', b === btn));
                    this.update();
                });
            });

            this.update();
        }

        update() {
            const total = this.totalMinutes;
            const delta = total - Math.round(this.base);
            const growing = total >= (this._lastTotal === undefined ? total : this._lastTotal);
            this._lastTotal = total;

            this.el.querySelector('#tw-group-value').textContent = `${this.state.group} чел 👤`;
            setTicker(this.el.querySelector('#tw-time-total'), this.base > 0 ? format(total) : '—', growing);

            const deltaEl = this.el.querySelector('#tw-time-delta');
            if (!this.base || delta === 0) {
                deltaEl.textContent = '';
                delete deltaEl.dataset.tick;
                return;
            }
            const abs = Math.abs(delta);
            const sign = delta > 0 ? '+' : '−';
            setTicker(deltaEl, abs >= 60
                ? `${sign}${Math.floor(abs / 60)}ч ${abs % 60}м`
                : `${sign}${abs}м`, growing);
            // Дольше базы — оранжевым, быстрее — зелёным: те же цвета сложности
            deltaEl.style.color = delta > 0 ? '#FF9800' : '#4CAF50';
        }
    }

    root.HikingTime = { minutes, format, FLAT_SPEED_KMH, METERS_PER_MINUTE_OF_CLIMB, TimePlanner };
})(typeof globalThis !== 'undefined' ? globalThis : window);
