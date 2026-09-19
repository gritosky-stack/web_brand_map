/* ── Цвет участка маршрута по локальному уклону ───────────────────────────────
 *
 * Порт `hikingmap/hikingmap/Services/GradeColor.swift` один в один: один и тот
 * же расчёт кормит линию на карте (`mapGradient`) и график высот (`gradient`),
 * чтобы обе отрисовки рассказывали одну и ту же историю одинаковыми цветами
 * на одних и тех же сегментах.
 *
 * Палитра продолжает шкалу сложности маршрута (зелёный → оранжевый →
 * красный → фиолетовый) в синий/голубой для спуска — отдельного языка цвета
 * под одну фичу не вводим.
 *
 * Файл общий для браузера и для Node: `tools/build_route_index.js` считает
 * этим же кодом то, что кладётся в routes_geom.json.
 */
(function (root) {
    'use strict';

    // Узлы линейной интерполяции: [уклон %, цвет]. Повтор значения в -2/+2
    // держит плоскую зелёную зону вокруг нуля вместо резкой границы ровно на
    // нуле — маршрут почти никогда не идёт идеально горизонтально.
    const STOPS = [
        [-25, [ 33, 150, 243]],   // #2196F3 — крутой спуск
        [-10, [  0, 188, 212]],   // #00BCD4 — пологий спуск
        [ -2, [ 76, 175,  80]],   // #4CAF50 — Difficulty.easy
        [  2, [ 76, 175,  80]],
        [  8, [255, 152,   0]],   // #FF9800 — Difficulty.medium
        [ 16, [244,  67,  54]],   // #F44336 — Difficulty.hard
        [ 28, [156,  39, 176]]    // #9C27B0 — Difficulty.expert
    ];

    /** Цвет уклона как [r, g, b], 0…255 */
    function rgbForGrade(grade) {
        if (!isFinite(grade)) return STOPS[2][1];
        if (grade <= STOPS[0][0]) return STOPS[0][1];
        const last = STOPS[STOPS.length - 1];
        if (grade >= last[0]) return last[1];
        for (let i = 1; i < STOPS.length; i++) {
            const [g0, c0] = STOPS[i - 1];
            const [g1, c1] = STOPS[i];
            if (grade <= g1) {
                const t = g1 > g0 ? (grade - g0) / (g1 - g0) : 0;
                return [
                    Math.round(c0[0] + (c1[0] - c0[0]) * t),
                    Math.round(c0[1] + (c1[1] - c0[1]) * t),
                    Math.round(c0[2] + (c1[2] - c0[2]) * t)
                ];
            }
        }
        return last[1];
    }

    function cssForGrade(grade, alpha) {
        const [r, g, b] = rgbForGrade(grade);
        return alpha === undefined || alpha >= 1
            ? `rgb(${r},${g},${b})`
            : `rgba(${r},${g},${b},${alpha})`;
    }

    function cssFromRgb(rgb, alpha) {
        return alpha === undefined || alpha >= 1
            ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
            : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    }

    /** Расстояние между двумя [lon, lat] в метрах */
    function meters(a, b) {
        const R = 6371000;
        const φ1 = a[1] * Math.PI / 180, φ2 = b[1] * Math.PI / 180;
        const dφ = φ2 - φ1;
        const dλ = (b[0] - a[0]) * Math.PI / 180;
        const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    }

    /**
     * Локальный уклон (%) между соседними точками, сглаженный скользящим
     * средним **по расстоянию**, а не по числу точек: на плотной записи трека
     * (точка каждые 5 м) и на редком треке окно иначе получалось бы разное.
     * Без сглаживания цвет дрожал бы на шуме GPS/DEM почти на каждом сегменте.
     */
    function segmentGrades(coords, eles, smoothingRadiusMeters) {
        const radius = smoothingRadiusMeters === undefined ? 60 : smoothingRadiusMeters;
        if (!coords || coords.length !== eles.length || coords.length < 2) return [];
        const n = coords.length - 1;

        const segDist = new Float64Array(n);
        const segGrade = new Float64Array(n);
        const midDist = new Float64Array(n);
        let cum = 0;
        for (let i = 0; i < n; i++) {
            const d = meters(coords[i], coords[i + 1]);
            const dh = eles[i + 1] - eles[i];
            segDist[i] = d;
            segGrade[i] = d > 1 ? (dh / d) * 100 : 0;
            midDist[i] = cum + d / 2;
            cum += d;
        }
        if (n <= 2) return Array.from(segGrade);

        const smoothed = new Array(n);
        let lo = 0, hi = 0;
        let windowDist = segDist[0];
        let windowGrade = segGrade[0] * segDist[0];
        for (let i = 0; i < n; i++) {
            while (hi < n - 1 && midDist[hi + 1] - midDist[i] <= radius) {
                hi++;
                windowDist += segDist[hi];
                windowGrade += segGrade[hi] * segDist[hi];
            }
            while (lo < i && midDist[i] - midDist[lo] > radius) {
                windowDist -= segDist[lo];
                windowGrade -= segGrade[lo] * segDist[lo];
                lo++;
            }
            smoothed[i] = windowDist > 0 ? windowGrade / windowDist : segGrade[i];
        }
        return smoothed;
    }

    /**
     * Уклон в точках (не в сегментах) — среднее двух соседних сегментов,
     * чтобы градиент был непрерывным от вершины до вершины, а не обрывался
     * на границах сегментов.
     */
    function pointGrades(coords, eles) {
        const seg = segmentGrades(coords, eles);
        if (!seg.length) return [];
        if (seg.length === 1) return [seg[0], seg[0]];
        const pts = new Array(seg.length + 1);
        pts[0] = seg[0];
        pts[pts.length - 1] = seg[seg.length - 1];
        for (let i = 1; i < pts.length - 1; i++) pts[i] = (seg[i - 1] + seg[i]) / 2;
        return pts;
    }

    /** Прореживание входа с обязательным сохранением концов */
    function resample(coords, eles, resolution) {
        if (coords.length <= resolution) return { coords, eles };
        const step = (coords.length - 1) / (resolution - 1);
        const idx = new Array(resolution);
        for (let i = 0; i < resolution; i++) idx[i] = Math.round(i * step);
        idx[resolution - 1] = coords.length - 1;
        return { coords: idx.map(i => coords[i]), eles: idx.map(i => eles[i]) };
    }

    function cumulativeMeters(coords) {
        const out = new Array(coords.length).fill(0);
        for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + meters(coords[i - 1], coords[i]);
        return out;
    }

    /**
     * Узлы раскраски по маршруту: доля пройденного пути (0…1) и цвет уклона.
     * Одно и то же представление и для графика, и для линии на карте.
     *
     * ⚠️ Считается по **полной** геометрии, а не по прореженному до 200 точек
     * профилю: на шаге ~57 м сглаживание окном 60 м фактически не работает,
     * цвет прыгает на каждой точке, и график становится полосатым.
     *
     *  - gradeResolution — потолок точек для расчёта уклона (шаг в десятки
     *    метров, мельче окна сглаживания, то есть на цвет уже не влияет);
     *  - maxStops — потолок числа узлов в самом градиенте.
     */
    function gradeStops(coordinates, elevations, gradeResolution, maxStops) {
        const res = gradeResolution || 800;
        const cap = maxStops || 200;
        if (!coordinates || coordinates.length !== elevations.length || coordinates.length < 2) return [];

        const { coords, eles } = resample(coordinates, elevations, res);
        const grades = pointGrades(coords, eles);
        if (grades.length !== coords.length || grades.length < 2) return [];

        const cumulative = cumulativeMeters(coords);
        const total = cumulative[cumulative.length - 1];
        if (!(total > 0)) return [];

        const step = Math.max(1, Math.ceil(coords.length / cap));
        const indices = [];
        for (let i = 0; i < coords.length; i += step) indices.push(i);
        if (indices[indices.length - 1] !== coords.length - 1) indices.push(coords.length - 1);

        // Позиции обязаны строго расти: две точки на одном месте дают одну и
        // ту же долю пути, и градиент отвалился бы молча
        const stops = [];
        for (let n = 0; n < indices.length; n++) {
            const i = indices[n];
            const position = Math.min(1, Math.max(0, cumulative[i] / total));
            if (stops.length && position <= stops[stops.length - 1].position) continue;
            // Уклон берём средним по куску, который этот узел собой
            // представляет, а не в одной его точке: на шуме высот соседние
            // точки легко разъезжаются с +20% до −20%, и выборка одной из них
            // превращала и график, и линию в штрих-код.
            const from = n === 0 ? 0 : indices[n - 1];
            const to = n === indices.length - 1 ? coords.length - 1 : indices[n + 1];
            stops.push({
                position,
                rgb: rgbForGrade(meanGrade(grades, cumulative, from, to, i))
            });
        }
        if (stops.length < 2) return [];
        if (stops[0].position > 0) stops.unshift({ position: 0, rgb: stops[0].rgb });
        const last = stops[stops.length - 1];
        if (last.position < 1) stops.push({ position: 1, rgb: last.rgb });
        return stops;
    }

    /** Средний уклон на куске from…to, взвешенный по длине отрезков */
    function meanGrade(grades, cumulative, from, to, at) {
        if (!(from < to) || to >= grades.length) return grades[at] || 0;
        let weighted = 0, span = 0;
        for (let i = from; i < to; i++) {
            const d = cumulative[i + 1] - cumulative[i];
            if (!(d > 0)) continue;
            weighted += (grades[i] + grades[i + 1]) / 2 * d;
            span += d;
        }
        return span > 0 ? weighted / span : (grades[at] || 0);
    }

    /**
     * Уклон в произвольных точках маршрута, заданных пройденными километрами —
     * тот же расчёт по **полной** геометрии, из которого берутся цвета линии
     * и графика. Нужен участкам профиля: они строятся по прореженным точкам,
     * где сглаживания фактически нет, и «уклон участка» иначе расходится с
     * цветом под пальцем.
     */
    function gradesAtDistances(coordinates, elevations, distancesKm, gradeResolution) {
        const res = gradeResolution || 800;
        if (!coordinates || coordinates.length !== elevations.length ||
            coordinates.length < 2 || !distancesKm.length) return [];

        const { coords, eles } = resample(coordinates, elevations, res);
        const grades = pointGrades(coords, eles);
        if (grades.length !== coords.length || grades.length < 2) return [];

        const cumKm = cumulativeMeters(coords).map(m => m / 1000);
        const total = cumKm[cumKm.length - 1];
        if (!(total > 0)) return [];

        // Обе шкалы монотонны — идём по ним одним курсором, а не бинарным
        // поиском на каждую точку
        const result = new Array(distancesKm.length);
        let cursor = 0;
        for (let n = 0; n < distancesKm.length; n++) {
            const target = Math.min(Math.max(distancesKm[n], 0), total);
            while (cursor < coords.length - 2 && cumKm[cursor + 1] < target) cursor++;
            const span = cumKm[cursor + 1] - cumKm[cursor];
            const t = span > 0 ? (target - cumKm[cursor]) / span : 0;
            result[n] = grades[cursor] + (grades[cursor + 1] - grades[cursor]) * Math.min(Math.max(t, 0), 1);
        }
        return result;
    }

    /**
     * Выражение `line-gradient` для линии маршрута — цвет по уклону вдоль
     * одной цельной линии.
     *
     * ⚠️ Раскраска идёт именно градиентом по **одной** LineString, а не
     * набором двухточечных отрезков со свойством "grade": отрезки длиной в
     * метры Mapbox упрощает по-тайлово и ниже z≈11 выкидывает — маршрут
     * пропадал бы с карты целиком.
     *
     * Требует у источника `lineMetrics: true` — без него `line-progress`
     * не считается и слой останется без цвета.
     *
     * `fraction` — какая доля линии сейчас нарисована (прогрессивная
     * отрисовка маршрута). `line-progress` считается от **нарисованной**
     * линии, поэтому узлы растягиваем на неё, иначе во время проявления
     * цвета съезжают к началу маршрута.
     */
    function mapGradient(stops, fraction) {
        if (!stops || stops.length < 2) return null;
        const f = fraction === undefined ? 1 : Math.min(1, Math.max(0.0001, fraction));
        const expr = ['interpolate', ['linear'], ['line-progress']];
        let previous = -1;
        for (const stop of stops) {
            if (stop.position > f) break;
            const position = Math.min(1, stop.position / f);
            if (position <= previous) continue;
            previous = position;
            expr.push(position, cssFromRgb(stop.rgb));
        }
        if (previous < 1) {
            // Хвост нарисованной части — цветом последнего попавшего узла
            const tail = stops.filter(s => s.position <= f).pop() || stops[0];
            expr.push(1, cssFromRgb(tail.rgb));
        }
        return expr.length >= 3 + 4 ? expr : null;   // минимум два узла
    }

    /**
     * Перевод «доли маршрута» (по полной геометрии — в ней считаются график,
     * уклоны и узлы раскраски) в `line-progress` линии на карте.
     *
     * ⚠️ Линия на карте упрощена (RDP) и короче настоящего маршрута на 5–8 %,
     * причём неравномерно: на извилистых кусках упрощение съедает больше.
     * `line-progress` — это доля длины **упрощённой** линии, и узел «38 %
     * маршрута», поставленный как есть, ложился не туда: оранжевый подъём на
     * графике оказывался на карте уже после бегунка, на зелёном (фидбэк
     * 2026-09-19). `coordKm` — километры вершин линии по полной геометрии —
     * связывает обе шкалы в каждой вершине, между вершинами — линейно.
     *
     * Нет `coordKm` (старый индекс) — возвращает долю как есть.
     */
    function progressMapper(coordinates, coordKm) {
        if (!coordinates || !coordKm || coordKm.length !== coordinates.length || coordinates.length < 2) {
            return f => f;
        }
        const lineM = cumulativeMeters(coordinates);
        const last = lineM.length - 1;
        const lineTotal = lineM[last];
        const kmTotal = coordKm[last];
        if (!(lineTotal > 0) || !(kmTotal > 0)) return f => f;
        return fraction => {
            const km = Math.min(Math.max(fraction, 0), 1) * kmTotal;
            if (km <= coordKm[0]) return 0;
            if (km >= kmTotal) return 1;
            let lo = 0, hi = last;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                if (coordKm[mid] <= km) lo = mid; else hi = mid;
            }
            const span = coordKm[hi] - coordKm[lo];
            const t = span > 0 ? (km - coordKm[lo]) / span : 0;
            return (lineM[lo] + (lineM[hi] - lineM[lo]) * t) / lineTotal;
        };
    }

    /**
     * Градиент для canvas-графика: узлы, обрезанные по видимому куску
     * (`from`…`to` — доли маршрута) и растянутые обратно на 0…1.
     *
     * ⚠️ После «щипка» рамка марок — это видимое окно, а не весь маршрут:
     * без обрезки цвета всего маршрута сжимались бы в это окно и разъезжались
     * с кривой. Обрезаем арифметикой по готовым узлам, уклоны заново не
     * считаем.
     */
    function windowedStops(stops, from, to) {
        if (!stops || stops.length < 2) return stops || [];
        if (!(to > from) || (from <= 0 && to >= 1)) return stops;

        const span = to - from;
        const out = [];
        for (const stop of stops) {
            if (stop.position < from || stop.position > to) continue;
            out.push({ position: (stop.position - from) / span, rgb: stop.rgb });
        }
        // Края окна попали между узлами — дотягиваем цветом соседа
        if (!out.length || out[0].position > 0) {
            let colour = stops[0].rgb;
            for (const s of stops) if (s.position <= from) colour = s.rgb;
            out.unshift({ position: 0, rgb: colour });
        }
        if (out[out.length - 1].position < 1) {
            const after = stops.find(s => s.position >= to);
            out.push({ position: 1, rgb: after ? after.rgb : stops[stops.length - 1].rgb });
        }
        return out;
    }

    /** CanvasGradient по узлам — для линии и заливки графика */
    function canvasGradient(ctx, x0, x1, stops, alpha) {
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        if (!stops || stops.length < 2) return null;
        for (const stop of stops) {
            grad.addColorStop(Math.min(1, Math.max(0, stop.position)), cssFromRgb(stop.rgb, alpha));
        }
        return grad;
    }

    root.GradeColor = {
        rgbForGrade, cssForGrade, cssFromRgb,
        meters, cumulativeMeters,
        segmentGrades, pointGrades,
        gradeStops, gradesAtDistances,
        mapGradient, windowedStops, canvasGradient, progressMapper
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
