/**
 * Прогноз погоды по маршруту — у старта и на высшей точке, на выбранный день.
 * Open-Meteo: бесплатно, без ключа, с CORS.
 *
 * Две точки, а не одна, потому что в горах это разная погода: на вершине в
 * полтора километра на 8–10 градусов холоднее и дует вдвое сильнее, чем у
 * станции, откуда стартуют. Высоту передаём сами (`elevation`), иначе
 * Open-Meteo возьмёт высоту своей клетки в 9 км и сгладит перепад.
 *
 * Дополняет «Планирование времени»: погодой дня можно одной кнопкой выставить
 * погодный множитель в планировщике (`TimePlanner` из time_planner.js).
 */
(function () {
    'use strict';

    const API = 'https://api.open-meteo.com/v1/forecast';
    const DAYS = 14;
    const cache = new Map();            // ключ маршрута → Promise<ответ>
    let selected = null;                // 'YYYY-MM-DD' — переживает смену маршрута
    let current = null;                 // { key, points }

    // Коды WMO → значок, слово и погода планировщика (0 ясно, 1 облачно, 2 дождь, 3 снег)
    function describe(code) {
        if (code === 0) return { icon: '☀️', text: 'Ясно', planner: 0 };
        if (code === 1) return { icon: '🌤', text: 'Малооблачно', planner: 0 };
        if (code === 2) return { icon: '⛅', text: 'Переменная облачность', planner: 1 };
        if (code === 3) return { icon: '☁️', text: 'Пасмурно', planner: 1 };
        if (code === 45 || code === 48) return { icon: '🌫', text: 'Туман', planner: 1 };
        if (code >= 51 && code <= 57) return { icon: '🌦', text: 'Морось', planner: 2 };
        if (code >= 61 && code <= 67) return { icon: '🌧', text: 'Дождь', planner: 2 };
        if (code >= 71 && code <= 77) return { icon: '🌨', text: 'Снег', planner: 3 };
        if (code >= 80 && code <= 82) return { icon: '🌧', text: 'Ливни', planner: 2 };
        if (code === 85 || code === 86) return { icon: '🌨', text: 'Снегопад', planner: 3 };
        if (code >= 95) return { icon: '⛈', text: 'Гроза', planner: 2 };
        return { icon: '🌡', text: '—', planner: 0 };
    }

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Даты — по Белграду: там и маршруты, и Open-Meteo считает дни в этой зоне
    function isoDay(d) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(d);
    }

    function dayLabel(iso, i) {
        if (i === 0) return 'Сегодня';
        if (i === 1) return 'Завтра';
        const d = new Date(iso + 'T12:00:00');
        const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' });
        return `${wd} ${d.getDate()}`;
    }

    /** Старт и высшая точка. Совпадают (петля с вершиной у старта) — одна */
    function pointsOf(routeData) {
        const pr = routeData.profile;
        const c = routeData.coordinates || [];
        const start = pr && pr.lon && pr.lon.length
            ? { lon: pr.lon[0], lat: pr.lat[0], ele: pr.ele[0] }
            : c.length ? { lon: c[0][0], lat: c[0][1], ele: null } : null;
        if (!start) return [];
        const out = [{ title: 'Старт', ...start }];
        const peak = routeData.peakCoords;
        if (peak && routeData.maxEle != null && (start.ele == null || routeData.maxEle - start.ele > 150)) {
            out.push({ title: 'Высшая точка', lon: peak[0], lat: peak[1], ele: routeData.maxEle });
        }
        return out;
    }

    function fetchForecast(points) {
        const q = new URLSearchParams({
            latitude: points.map(p => p.lat.toFixed(4)).join(','),
            longitude: points.map(p => p.lon.toFixed(4)).join(','),
            daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
                    'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
                    'sunrise', 'sunset'].join(','),
            timezone: 'Europe/Belgrade', forecast_days: String(DAYS)
        });
        if (points.every(p => p.ele != null)) q.set('elevation', points.map(p => Math.round(p.ele)).join(','));
        return fetch(`${API}?${q}`).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).then(j => Array.isArray(j) ? j : [j]);
    }

    function host() { return document.getElementById('route-weather'); }
    function wrapper() { return document.getElementById('panel-weather-wrapper'); }

    function show(routeInfo, routeData) {
        const w = wrapper();
        if (!w) return;
        const points = pointsOf(routeData || {});
        if (!points.length) { w.classList.add('hidden'); current = null; return; }
        w.classList.remove('hidden');
        const key = routeInfo.id + '|' + points.map(p => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join(';');
        current = { key, points };

        // Для плана — его дата, если она в окне прогноза
        const today = isoDay(new Date());
        if (routeInfo.future && routeInfo.date) {
            const planned = String(routeInfo.date).slice(0, 10);
            if (planned >= today) selected = planned;
        }

        host().innerHTML = '<div class="wx-loading">Загружаю прогноз…</div>';
        if (!cache.has(key)) {
            const p = fetchForecast(points);
            cache.set(key, p);
            p.catch(() => cache.delete(key));
        }
        cache.get(key).then(data => { if (current && current.key === key) render(data); })
            .catch(e => {
                console.warn('[weather]', e);
                if (current && current.key === key) {
                    host().innerHTML = '<div class="wx-loading">Прогноз сейчас недоступен</div>';
                }
            });
    }

    function render(data) {
        const days = data[0].daily.time;
        if (!selected || !days.includes(selected)) selected = days[0];
        const i = days.indexOf(selected);

        const chips = days.map((d, k) =>
            `<button class="wx-day${d === selected ? ' active' : ''}" data-day="${d}">${dayLabel(d, k)}</button>`).join('');

        const cards = current.points.map((pt, k) => {
            const dd = data[k].daily;
            const w = describe(dd.weather_code[i]);
            const rain = dd.precipitation_sum[i], prob = dd.precipitation_probability_max[i];
            const wind = dd.wind_speed_10m_max[i], gust = dd.wind_gusts_10m_max[i];
            const windy = gust >= 50 || wind >= 35;
            return `
                <div class="wx-card">
                    <div class="wx-card-h">${pt.title}${pt.ele != null ? ` · ${Math.round(pt.ele)} м` : ''}</div>
                    <div class="wx-main">
                        <span class="wx-icon" title="${esc(w.text)}">${w.icon}</span>
                        <span class="wx-temp">${Math.round(dd.temperature_2m_max[i])}°<small> / ${Math.round(dd.temperature_2m_min[i])}°</small></span>
                    </div>
                    <div class="wx-desc">${esc(w.text)}</div>
                    <div class="wx-line${windy ? ' wx-warn' : ''}">💨 ${Math.round(wind)} км/ч${gust ? `, порывы ${Math.round(gust)}` : ''}</div>
                    <div class="wx-line">💧 ${rain > 0 ? `${rain.toFixed(1)} мм` : 'без осадков'}${prob != null ? ` · ${prob}%` : ''}</div>
                </div>`;
        }).join('');

        const d0 = data[0].daily;
        const hhmm = s => (s || '').slice(11, 16);
        // Погода для планировщика — худшая из точек: идти предстоит через обе
        const plannerIdx = Math.max(...current.points.map((_, k) => describe(data[k].daily.weather_code[i]).planner));
        const planner = window.RouteProfile && RouteProfile.planner;
        const alreadySet = planner && planner.state.weather === plannerIdx;

        host().innerHTML = `
            <div class="wx-days scrollbar-hide">${chips}</div>
            <div class="wx-cards">${cards}</div>
            <div class="wx-foot">
                <span>☀️ ${hhmm(d0.sunrise[i])} – ${hhmm(d0.sunset[i])}</span>
                ${planner ? `<button class="wx-apply" ${alreadySet ? 'disabled' : ''}>${alreadySet ? 'Учтено в расчёте времени' : 'Учесть в расчёте времени'}</button>` : ''}
            </div>
            <div class="wx-credit">Open-Meteo · прогноз по высоте точки</div>`;

        host().querySelectorAll('.wx-day').forEach(b => {
            b.onclick = () => { selected = b.dataset.day; render(data); };
        });
        const apply = host().querySelector('.wx-apply');
        if (apply) apply.onclick = () => {
            planner.state.weather = plannerIdx;
            planner.saveState();
            planner.render();
            render(data);
        };
        // Выбранный день — в середину ленты. Не `scrollIntoView`: тот
        // прокрутил бы заодно всю карточку маршрута
        const strip = host().querySelector('.wx-days'), active = strip.querySelector('.active');
        if (active) strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    }

    function hide() {
        current = null;
        const w = wrapper();
        if (w) w.classList.add('hidden');
    }

    window.RouteWeather = { show, hide };
})();
