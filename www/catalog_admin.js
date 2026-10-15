/**
 * Авторская карточка маршрута каталога — то, что видят все.
 *
 * Статус («пройден», «скоро идём», «в запасе») был здесь и раньше, в
 * `catalog_status` (route_status.js рисует переключатель). Но «пройден» —
 * это не цвет метки, а поход: группа прошла не ровно по нарисованной тропе,
 * фотографии появились свои, время известно фактическое. Поэтому строка
 * каталога несёт **замену** авторской карточке:
 *
 *   track        — фактический GPX (бакет `route-tracks`). Есть он — сайт
 *                  рисует его вместо файла из `www/`, и цифры считаются по нему.
 *   photos       — [{p, c}], как у отметок: заменяют авторские фотографии.
 *   note         — описание вместо авторского.
 *   duration_min — сколько занял поход.
 *
 * Строка с ключом `pub_<uuid>` — целый маршрут, **опубликованный** админом из
 * своего: в `www/` файла у него нет, и геометрия живёт в том же бакете.
 * Так в каталог попадает только что нарисованный или загруженный маршрут —
 * до этого авторским мог стать лишь тот, что лежит файлом в репозитории.
 *
 * ⚠️ Опубликованный маршрут перестаёт быть «моим»: пока строка каталога
 * жива, личная копия (`routes`) с карты и из ленты «Мои» снимается
 * (`source_id` → `MyRoutes.refreshRegistrations`). Иначе на одном месте
 * висели бы две метки с одним названием — авторская и своя. Сняли с
 * публикации — копия возвращается, ничего не потеряно.
 *
 * ⚠️ Время похода берём **из трека**: в записи с часов или телефона есть
 * `<time>` у каждой точки, и разница между первой и последней — это и есть
 * «сколько заняло». Нет времени (трек нарисован в планировщике) — спрашиваем
 * у админа, а не пишем оценку молча.
 *
 * Права проверяет база: писать `catalog_status` и бакет `route-tracks` может
 * только `is_admin()`. Здесь — интерфейс, который этим пользуется.
 *
 * Зависит от script.js (`routes`, `parsedRouteDataCache`, `parseGPX`,
 * `replaceRouteGeometry`, `registerUserRoute`, `unregisterUserRoute`),
 * route_status.js (строки каталога и перерисовка), account.js и user_photos.js.
 */
(function () {
    'use strict';

    const BUCKET = 'route-tracks';
    const PUB = 'pub_';                 // ключ опубликованного маршрута

    const C = () => (window.STATUS_COLOR || { done: '#ff4d4d', planned: '#FF8C00', idle: '#7A5EA6' });
    const client = () => (window.Account && Account.client && Account.client()) || null;
    const toast = t => (window.MyRoutes ? MyRoutes.toast(t) : console.warn(t));
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // ⚠️ `routes` и `parsedRouteDataCache` объявлены в script.js через
    // `const` — это глобальные лексические привязки, свойствами `window` они
    // не становятся (см. ту же оговорку в route_status.js).
    const all = () => (typeof routes !== 'undefined' ? routes : {});
    const cache = () => (typeof parsedRouteDataCache !== 'undefined' ? parsedRouteDataCache : {});
    const viewed = () => (typeof currentViewedRoute !== 'undefined' ? currentViewedRoute : null);

    function uuid() {
        return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 3 | 8)).toString(16);
            });
    }

    function trackURL(path) {
        if (!path) return null;
        if (/^https?:/.test(path)) return path;
        return `${SUPA.URL}/storage/v1/object/public/${BUCKET}/` +
            String(path).split('/').map(encodeURIComponent).join('/');
    }

    /** «6h 24m» — тот же вид, что у `overrideTime` маршрутов каталога. */
    function fmtDur(min) {
        if (!min || min < 1) return null;
        const h = Math.floor(min / 60), m = Math.round(min % 60);
        return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    }

    function todayISO() {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
    }

    function isoDay(d) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(d);
    }

    const photoList = row => (row && Array.isArray(row.photos)) ? row.photos : [];

    function photoGeoms(ph) {
        return ph.map(x => ({ src: UserPhotos.urlOf(x.p), coords: x.c || null }));
    }

    // ── Разбор выбранного GPX ───────────────────────────────────────────────

    /**
     * Время похода из трека: разница между первой и последней точкой с
     * `<time>`. Часы и телефоны его пишут, планировщики — нет.
     */
    function trackSpan(text) {
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        const pts = xml.getElementsByTagName('trkpt');
        let first = null, last = null;
        for (let i = 0; i < pts.length; i++) {
            const t = pts[i].getElementsByTagName('time')[0];
            if (!t) continue;
            const d = new Date(t.textContent);
            if (isNaN(d)) continue;
            if (!first) first = d;
            last = d;
        }
        if (!first || !last || last - first < 60000) return null;
        return { start: first, end: last, minutes: Math.round((last - first) / 60000) };
    }

    /** Сводка по файлу: километры, набор и время, если оно в треке есть. */
    function readTrack(text) {
        const data = (typeof parseGPX !== 'undefined') ? parseGPX(text) : null;
        if (!data) return null;
        return { data, span: trackSpan(text), distance: data.distance, ascent: data.ascent };
    }

    function pickGPXFile() {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.gpx,application/gpx+xml,application/xml,text/xml';
            input.style.display = 'none';
            input.addEventListener('change', () => {
                const f = input.files && input.files[0];
                input.remove();
                resolve(f || null);
            });
            document.body.appendChild(input);
            input.click();
        });
    }

    async function uploadTrack(key, text) {
        const c = client();
        if (!c) throw new Error('not signed in');
        const path = `${key}/${uuid()}.gpx`;
        const blob = new Blob([text], { type: 'application/gpx+xml' });
        const { error } = await c.storage.from(BUCKET)
            .upload(path, blob, { contentType: 'application/gpx+xml', upsert: false });
        if (error) throw error;
        return path;
    }

    /** Ошибку глотаем: строка уже без этого трека, застрявший файл не страшен. */
    async function removeTrack(path) {
        const c = client();
        if (!c || !path) return;
        try { await c.storage.from(BUCKET).remove([path]); }
        catch (e) { console.warn('[catalog] удаление трека:', e); }
    }

    // ── Что из строки каталога попадает на карту ────────────────────────────

    let published = new Map();   // route_key → подпись строки (чтобы не качать трек зря)
    let sources = new Set();     // id строк `routes`, опубликованных в каталог
    let reveal = null;           // только что опубликованный маршрут — открыть, когда доедет

    /**
     * Переопределения приехали из базы. Файловым маршрутам каталога правим
     * карточку на месте, опубликованные — регистрируем как обычные маршруты.
     */
    function apply(catalogMap) {
        const pubs = new Map();
        const src = new Set();
        catalogMap.forEach((row, key) => {
            if (row.source_id) src.add(row.source_id);
            if (key.indexOf(PUB) === 0) pubs.set(key, row);
            else applyOverride(key, row);
        });
        syncPublished(pubs);
        const changed = src.size !== sources.size || [...src].some(id => !sources.has(id));
        sources = src;
        // Личная копия опубликованного маршрута уходит с карты и из «Моих»
        if (changed && window.MyRoutes && MyRoutes.refreshRegistrations) MyRoutes.refreshRegistrations();
    }

    function sameList(a, b) {
        a = a || []; b = b || [];
        return a.length === b.length && a.every((x, i) => x === b[i]);
    }

    function applyOverride(key, row) {
        const r = all()[key];
        if (!r || r.mine || r.shared) return;
        // Исходную карточку запоминаем один раз: убрали переопределение —
        // маршрут обязан вернуться к тому, что лежит в `routesList`
        if (!r._orig) {
            r._orig = { photos: r.photos || [], description: r.description, overrideTime: r.overrideTime };
        }
        let panel = false;
        const note = row.note || r._orig.description;
        if (r.description !== note) { r.description = note; panel = true; }
        const time = row.duration_min ? fmtDur(row.duration_min) : r._orig.overrideTime;
        if (r.overrideTime !== time) { r.overrideTime = time; panel = true; }

        const ph = photoList(row);
        const urls = ph.length ? ph.map(x => UserPhotos.urlOf(x.p)) : r._orig.photos;
        if (!sameList(r.photos, urls)) {
            r.photos = urls;
            r._catalogPhotos = ph.length ? ph : null;
            applyPhotos(r);
            panel = true;
        }
        applyTrack(r, row.track || null);
        if (panel) refreshPanel(r);
    }

    /**
     * Фото каталога уже с координатами (`{p, c}`) — EXIF для них читать
     * незачем. Авторские запоминаем, чтобы вернуть их, когда админ свои
     * уберёт.
     */
    function applyPhotos(r) {
        const data = cache()[r.id];
        if (!data) return;                    // не загружен — поймает onRouteLoaded
        if (data._authorGeoms === undefined) data._authorGeoms = data._exifDone ? data.photoGeoms : null;
        const ph = r._catalogPhotos;
        if (ph && ph.length) {
            data.photoGeoms = photoGeoms(ph);
            data._exifDone = true;
        } else if (data._authorGeoms) {
            data.photoGeoms = data._authorGeoms;
            data._exifDone = true;
        } else {
            data.photoGeoms = [];
            data._exifDone = false;
            if (window.resetRouteExif) resetRouteExif(r.id);
        }
    }

    /** Маршрут дочитался позже, чем приехали переопределения. */
    function onRouteLoaded(routeInfo, routeData) {
        if (!routeInfo._catalogPhotos) return;
        routeData._authorGeoms = null;
        routeData.photoGeoms = photoGeoms(routeInfo._catalogPhotos);
        routeData._exifDone = true;
    }

    function applyTrack(r, path) {
        const url = trackURL(path);
        if ((r.trackURL || null) === (url || null)) return;
        r.trackURL = url;
        if (!cache()[r.id]) return;          // ещё не загружен — возьмёт loadRouteData
        reloadGeometry(r, url || r.file);
    }

    async function reloadGeometry(r, src) {
        if (!src) return;
        try {
            const res = await fetch(/^https?:/.test(src) ? src : encodeURI(src));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = (typeof parseGPX !== 'undefined') ? parseGPX(await res.text()) : null;
            if (!data) throw new Error('в треке нет точек');
            const prev = cache()[r.id];
            data._authorGeoms = prev ? prev._authorGeoms : null;
            window.replaceRouteGeometry(r, data);
            applyPhotos(r);
            if (window.refreshPanelReport) refreshPanelReport(viewed());
        } catch (e) {
            console.warn('[catalog] трек не перечитан:', e);
        }
    }

    // ── Опубликованные маршруты ─────────────────────────────────────────────

    function infoFor(key, row) {
        const status = row.status || 'done';
        const ph = photoList(row);
        return {
            id: key, published: true, sourceId: row.source_id || null,
            // `file` — адрес трека: по нему работает «Скачать GPX» каталога
            file: trackURL(row.track),
            trackURL: trackURL(row.track),
            name: row.name || 'Маршрут',
            status, color: C()[status] || C().done, future: false,
            overrideAscent: null, overrideDescent: null,
            overrideTime: fmtDur(row.duration_min), overrideMinEle: null,
            date: row.date || null,
            description: row.note || null, instagramUrl: null,
            _catalogPhotos: ph.length ? ph : null,
            photos: ph.map(x => UserPhotos.urlOf(x.p)), videos: []
        };
    }

    function syncPublished(pubs) {
        pubs.forEach((row, key) => {
            const sig = JSON.stringify([row.track, row.name, row.status, row.date,
                                        row.note, row.duration_min, row.photos]);
            if (published.get(key) === sig) return;
            published.set(key, sig);
            loadPublished(key, row);
        });
        [...published.keys()].forEach(key => {
            if (pubs.has(key)) return;
            published.delete(key);
            if (window.unregisterUserRoute) unregisterUserRoute(key);
            refreshCatalog();
        });
    }

    /**
     * Трек опубликованного маршрута качаем один раз: сменили у него статус
     * или описание — правим карточку на месте, геометрия не менялась.
     */
    async function loadPublished(key, row) {
        if (!row.track) return;
        const info = infoFor(key, row);
        const existing = all()[key];
        if (existing && existing.trackURL === info.trackURL && cache()[key]) {
            Object.assign(existing, info);
            applyPhotos(existing);
            refreshCatalog();
            refreshPanel(existing);
            return;
        }
        try {
            const res = await fetch(info.trackURL);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = (typeof parseGPX !== 'undefined') ? parseGPX(await res.text()) : null;
            if (!data) throw new Error('в треке нет точек');
            data._authorGeoms = null;
            data.photoGeoms = info._catalogPhotos ? photoGeoms(info._catalogPhotos) : [];
            data._exifDone = true;
            window.registerUserRoute(info, data);
            refreshCatalog();
            // Только что опубликовали — показываем результат. Через таймер
            // это было бы гадание: трек ещё качается, и открывать нечего
            if (reveal === key) { reveal = null; if (window.flyToRoute) flyToRoute(key); }
        } catch (e) {
            console.warn('[catalog] опубликованный маршрут', key, e);
            published.delete(key);
            if (reveal === key) { reveal = null; toast('Маршрут записан, но трек не прочитался'); }
        }
    }

    function refreshCatalog() {
        if (window.refreshCatalogMenus) refreshCatalogMenus();
        if (window.refreshCarousel) refreshCarousel();
        if (window.refreshRouteProps) refreshRouteProps();
        if (window.recomputeAuthorKm) recomputeAuthorKm();
        if (window.setFilter && window.activeFilter) setFilter(activeFilter());
    }

    function refreshPanel(r) {
        const v = viewed();
        if (!v || v.id !== r.id) return;
        if (window.refreshPanelBadge) refreshPanelBadge(r);
        if (window.refreshPanelReport) refreshPanelReport(r);
        if (window.RouteStatus) RouteStatus.renderPanel(r);
        const d = document.getElementById('panel-description');
        const w = document.getElementById('panel-description-wrapper');
        if (d && w && r.description) { d.textContent = r.description; w.classList.remove('hidden'); }
        const t = document.getElementById('panel-time');
        if (t && r.overrideTime) t.textContent = r.overrideTime;
    }

    /** Опубликован ли из этой строки `routes` маршрут каталога. */
    function isPublishedSource(cloudId) { return sources.has(cloudId); }

    function publishedKeyOf(cloudId) {
        const rows = (window.RouteStatus && RouteStatus.catalogRows()) || new Map();
        let found = null;
        rows.forEach((row, key) => { if (row.source_id === cloudId) found = key; });
        return found;
    }

    // ── Окно «авторская карточка» ───────────────────────────────────────────

    let st = null;          // состояние открытого окна

    function ensureModal() {
        let el = document.getElementById('catalog-modal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'catalog-modal';
        el.className = 'tw-modal';
        el.innerHTML = '<div class="tw-modal-inner" id="catalog-modal-inner"></div>';
        el.addEventListener('click', e => { if (e.target === el) close(false); });
        document.body.appendChild(el);
        return el;
    }

    /**
     * Закрытие окна. Результат уезжает тому, кто его открыл: переключатель
     * статуса двигает «пилюлю» сразу по нажатию и обязан откатить её, если
     * окно закрыли без сохранения (та же оговорка, что у `moveThumb` в
     * route_status.js).
     */
    function close(result) {
        const el = document.getElementById('catalog-modal');
        if (el) el.classList.remove('open');
        const prev = st;
        st = null;
        if (prev && prev.resolve) prev.resolve(!!result);
    }

    /**
     * @param {object} o
     *   routeInfo — маршрут, с которым работаем
     *   publish   — true: свой маршрут отправляется в каталог
     *   status    — статус, который выбрали кнопкой
     */
    function open(o) {
        if (st) return Promise.resolve(false);      // окно уже открыто
        const r = o.routeInfo;
        const row = o.row || {};
        const key = o.publish ? (publishedKeyOf(r.cloudId) || (PUB + uuid())) : r.id;
        const data = cache()[r.id] || {};
        const dur = row.duration_min || 0;
        st = {
            routeInfo: r, row, key, publish: !!o.publish,
            status: o.status || row.status || r.status || 'done',
            name: row.name || r.name || '',
            date: (row.date || (r.date || '').slice(0, 10) || todayISO()).slice(0, 10),
            hours: dur ? Math.floor(dur / 60) : '',
            mins: dur ? dur % 60 : '',
            note: row.note || r.description || '',
            keep: photoList(row).slice(),
            removed: [], files: [],
            trackText: null, trackName: null, trackStats: null,
            clearTrack: false,
            distance: data.distance || 0,
            busy: false, msg: ''
        };
        // Опубликовать можно только то, у чего есть геометрия: трек своего
        // маршрута собираем из его же точек
        if (st.publish && window.MyRoutes && MyRoutes.gpxOf) {
            st.trackText = MyRoutes.gpxOf(r.cloudId);
            st.trackName = 'трек вашего маршрута';
            st.trackStats = st.trackText ? readTrack(st.trackText) : null;
        }
        ensureModal().classList.add('open');
        render();
        return new Promise(resolve => { st.resolve = resolve; });
    }

    const SEG = [
        { value: 'done',    label: 'Пройден',    key: 'done' },
        { value: 'planned', label: 'Скоро идём', key: 'planned' },
        { value: 'idle',    label: 'В запасе',   key: 'idle' }
    ];

    function segment() {
        const i = Math.max(0, SEG.findIndex(s => s.value === st.status));
        const btns = SEG.map(s => `
            <button class="rs-seg-btn${s.value === st.status ? ' active' : ''}" data-cat-pick="${s.value}">
                <span>${s.label}</span>
            </button>`).join('');
        return `<div class="rs-seg" style="--seg-n:3;--seg-i:${i};--seg-color:${C()[st.status] || C().done}">
                    <span class="rs-seg-thumb" aria-hidden="true"></span>${btns}
                </div>`;
    }

    function trackBlock() {
        const stat = st.trackStats;
        const stored = st.row && st.row.track && !st.clearTrack;
        let summary;
        if (stat) {
            const parts = [`${stat.distance.toFixed(1)} км`];
            if (stat.ascent) parts.push(`${stat.ascent} м набора`);
            if (stat.span) parts.push(`время в треке: ${fmtDur(stat.span.minutes)}`);
            summary = `<div class="ca-track-ok">${esc(st.trackName || 'новый трек')} · ${parts.join(' · ')}</div>`;
        } else if (stored) {
            summary = `<div class="ca-track-ok">Сейчас стоит фактический трек
                <button class="rs-link" id="ca-track-reset">вернуть исходный</button></div>`;
        } else {
            summary = `<div class="tw-note">${st.publish
                ? 'Возьмём трек вашего маршрута' : 'Трек каталога остаётся прежним'}</div>`;
        }
        const hint = st.publish
            ? 'Если группа прошла не ровно по нарисованному, положите сюда фактическую запись — в каталог уедет она. Время похода возьмём из трека, если оно там есть.'
            : 'Заменит трек маршрута у всех — пригодится, когда группа прошла не ровно по нарисованной тропе. Время похода возьмём из трека, если оно там есть.';
        return `<div class="rs-field mt-4"><span>${st.publish ? 'Трек' : 'Фактический трек'}</span>
            <button class="rs-cta rs-cta-sm" id="ca-track-pick">Выбрать GPX-файл</button>
            ${summary}
            <div class="tw-note">${hint}</div>
        </div>`;
    }

    function photoBlock() {
        if (!window.UserPhotos) return '';
        const kept = st.keep.map((ph, i) =>
            `<div class="rs-ph"><img src="${esc(UserPhotos.urlOf(ph.p))}" alt="" loading="lazy">
                <button class="rs-ph-x" data-drop-keep="${i}" title="Убрать">×</button></div>`).join('');
        const fresh = st.files.map((f, i) =>
            `<div class="rs-ph"><img src="${esc(URL.createObjectURL(f))}" alt="">
                <button class="rs-ph-x" data-drop-file="${i}" title="Убрать">×</button></div>`).join('');
        const total = st.keep.length + st.files.length;
        const add = total < UserPhotos.MAX_FILES
            ? `<button class="rs-ph-add" id="ca-ph-add"><span>+ Фото</span></button>` : '';
        return `<div class="rs-field mt-4"><span>Фотографии каталога</span>
            <div class="rs-phs">${add}${kept}${fresh}</div>
            <div class="tw-note" id="ca-ph-note">${total
                ? `${total} из ${UserPhotos.MAX_FILES} — заменят авторские фото этого маршрута у всех`
                : 'Пусто — останутся фотографии из каталога'}</div>
        </div>`;
    }

    function timeBlock() {
        const span = st.trackStats && st.trackStats.span;
        const hint = span
            ? 'Взято из трека — можно поправить'
            : 'В треке нет времени точек — впишите, сколько заняло';
        return `<div class="rs-fields">
                <label class="rs-field"><span>Часов</span>
                    <input type="number" class="review-input" id="ca-h" min="0" max="48" inputmode="numeric"
                           value="${esc(st.hours)}" placeholder="0"></label>
                <label class="rs-field"><span>Минут</span>
                    <input type="number" class="review-input" id="ca-m" min="0" max="59" inputmode="numeric"
                           value="${esc(st.mins)}" placeholder="00"></label>
            </div>
            <div class="tw-note">${hint}</div>`;
    }

    // Пояснения к разметке пишем здесь, а не внутри шаблона: обратная кавычка
    // в HTML-комментарии закрывает шаблонную строку и роняет файл.
    function render() {
        const inner = document.getElementById('catalog-modal-inner');
        if (!inner || !st) return;
        const title = st.publish ? 'В каталог' : 'Авторская карточка';
        const dateLabel = st.status === 'planned' ? 'Когда идём' : 'Когда прошли';
        const dateField = st.status === 'idle' ? '' : `
            <div class="rs-fields">
                <label class="rs-field"><span>${dateLabel}</span>
                    <input type="date" class="review-input" id="ca-date" value="${esc(st.date)}"></label>
            </div>`;

        inner.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="min-w-0 pr-3">
                    <h3 class="text-white text-base font-semibold">${title}</h3>
                    <div class="text-zinc-500 text-xs truncate mt-0.5">${esc(st.routeInfo.name)} · виден всем</div>
                </div>
                <button class="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" id="ca-x" aria-label="Закрыть">
                    <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            ${st.publish ? `<label class="rs-field"><span>Название в каталоге</span>
                <input class="review-input" id="ca-name" maxlength="120" value="${esc(st.name)}"></label>` : ''}
            <div class="rs-field mt-4"><span>Статус в каталоге</span>${segment()}</div>
            ${dateField}
            ${st.status === 'done' ? timeBlock() : ''}
            ${trackBlock()}
            ${photoBlock()}
            <label class="rs-field mt-4"><span>Описание</span>
                <textarea class="review-input" id="ca-note" maxlength="4000" rows="4"
                    placeholder="Как прошло, что было по дороге — это описание увидят все"
                    style="resize:none;display:block">${esc(st.note)}</textarea></label>
            <div class="tw-note mt-3" id="ca-msg">${esc(st.msg)}</div>
            <div class="flex gap-2 mt-5">
                <button class="tw-btn tw-btn-ghost" id="ca-cancel">Отмена</button>
                <button class="tw-btn tw-btn-mine" id="ca-ok">${st.publish ? 'Опубликовать' : 'Сохранить'}</button>
            </div>`;

        wire(inner);
    }

    /** Набранное забираем перед каждой перерисовкой: разметка собирается
     *  через `innerHTML`, и текст пропал бы вместе с полями. */
    function readForm(inner) {
        if (!st || !inner) return;
        const get = id => inner.querySelector('#' + id);
        const n = get('ca-note'); if (n) st.note = n.value;
        const nm = get('ca-name'); if (nm) st.name = nm.value;
        const d = get('ca-date'); if (d && d.value) st.date = d.value;
        const h = get('ca-h'); if (h) st.hours = h.value;
        const m = get('ca-m'); if (m) st.mins = m.value;
    }

    function wire(inner) {
        const q = id => inner.querySelector('#' + id);
        q('ca-x').onclick = () => close(false);
        q('ca-cancel').onclick = () => close(false);
        q('ca-ok').onclick = () => { readForm(inner); save(); };

        inner.querySelectorAll('[data-cat-pick]').forEach(b => {
            b.onclick = () => { readForm(inner); st.status = b.dataset.catPick; render(); };
        });

        q('ca-track-pick').onclick = async () => {
            const f = await pickGPXFile();
            if (!f) return;
            readForm(inner);
            const text = await f.text();
            const stat = readTrack(text);
            if (!stat) { toast('В этом файле нет трека'); return; }
            st.trackText = text;
            st.trackName = f.name;
            st.trackStats = stat;
            st.clearTrack = false;
            st.distance = stat.distance;
            // Время и дату подставляем из трека: в записи с часов они есть,
            // и спрашивать то, что уже известно, незачем
            if (stat.span) {
                st.hours = Math.floor(stat.span.minutes / 60);
                st.mins = stat.span.minutes % 60;
                st.date = isoDay(stat.span.start);
            }
            render();
        };
        const reset = q('ca-track-reset');
        if (reset) reset.onclick = () => {
            readForm(inner);
            st.clearTrack = true; st.trackText = null; st.trackStats = null; st.trackName = null;
            render();
        };

        const add = q('ca-ph-add');
        if (add) add.onclick = async () => {
            const files = await UserPhotos.pick(true);
            const room = UserPhotos.MAX_FILES - st.keep.length - st.files.length;
            readForm(inner);
            st.files = st.files.concat(files.slice(0, Math.max(0, room)));
            render();
        };
        inner.querySelectorAll('[data-drop-keep]').forEach(b => {
            b.onclick = () => {
                readForm(inner);
                st.removed = st.removed.concat(st.keep.splice(+b.dataset.dropKeep, 1));
                render();
            };
        });
        inner.querySelectorAll('[data-drop-file]').forEach(b => {
            b.onclick = () => { readForm(inner); st.files.splice(+b.dataset.dropFile, 1); render(); };
        });
    }

    /** Подпись о ходе сохранения. Правим текст на месте, а не перерисовкой:
     *  под ней живут выбранные файлы и набранное описание. */
    function setMsg(text) {
        if (st) st.msg = text;
        const el = document.getElementById('ca-msg');
        if (el) el.textContent = text;
    }

    /**
     * Сохранение. Трек и фото заливаются **пока окно открыто**, с подписью о
     * том, что идёт: с телефона это десятки секунд, и в тишине человек решит,
     * что ничего не происходит (как в окне «Пройден», route_status.js).
     */
    async function save() {
        if (!st || st.busy) return;
        const c = client();
        if (!c) { toast('Нужен вход'); return; }
        const inner = document.getElementById('catalog-modal-inner');
        const ok = inner && inner.querySelector('#ca-ok');
        if (st.publish && !String(st.name).trim()) { toast('Дайте маршруту название'); return; }
        // В каталоге маршрут живёт своим треком: у файловых он лежит в `www/`,
        // у опубликованного — только в бакете, и без него карточка пустая
        if (st.publish && !st.trackText) { toast('Не удалось собрать трек маршрута'); return; }
        st.busy = true;
        if (ok) ok.disabled = true;
        const oldTrack = (st.row && st.row.track) || null;
        try {
            let track = st.clearTrack ? null : oldTrack;
            if (st.trackText) {
                setMsg('Загружаю трек…');
                track = await uploadTrack(st.key, st.trackText);
            }
            let photos = st.keep;
            if (st.files.length && window.UserPhotos) {
                photos = st.keep.concat(await UserPhotos.upload(st.files, st.key, (i, total) => {
                    setMsg(`Загружаю фото ${Math.min(i + 1, total)} из ${total}…`);
                }));
            }
            setMsg('Сохраняю…');
            const minutes = (parseInt(st.hours, 10) || 0) * 60 + (parseInt(st.mins, 10) || 0);
            const row = {
                route_key: st.key,
                status: st.status,
                date: st.status === 'idle' ? null : (st.date || null),
                track, photos,
                note: String(st.note).trim() || null,
                duration_min: st.status === 'done' && minutes > 0 ? minutes : null,
                updated_at: new Date().toISOString()
            };
            if (st.publish) {
                row.name = String(st.name).trim().slice(0, 120);
                row.source_id = st.routeInfo.cloudId;
                row.distance_km = st.distance || 0;
            }
            const { error } = await c.from('catalog_status').upsert(row);
            if (error) throw error;

            // Подменённый трек и убранные фото сносим **после** удачной
            // записи: упади она раньше — строка ссылалась бы на пустоту
            if (track !== oldTrack && oldTrack) removeTrack(oldTrack);
            if (st.removed.length && window.UserPhotos) UserPhotos.remove(st.removed);

            const wasPublish = st.publish;
            const key = st.key;
            if (wasPublish) reveal = key;
            close(true);
            // Строка уходит в route_status.js: он держит карту переопределений
            // и он же их применяет (`applyCatalog`) — двух источников правды
            // здесь быть не должно
            if (window.RouteStatus) RouteStatus.ingestRow(row);
            toast(wasPublish ? 'Маршрут опубликован в каталоге' : 'Авторская карточка обновлена');
        } catch (e) {
            console.warn('[catalog] сохранение:', e);
            if (st) st.busy = false;
            if (ok) ok.disabled = false;
            setMsg('Не удалось сохранить. Это может только автор каталога');
        }
    }

    /** Снять маршрут с публикации: строка каталога уходит, личная копия
     *  возвращается в «Мои». */
    async function unpublish(key) {
        const c = client();
        const rows = (window.RouteStatus && RouteStatus.catalogRows()) || new Map();
        const row = rows.get(key);
        if (!c || !row) return false;
        try {
            const { error } = await c.from('catalog_status').delete().eq('route_key', key);
            if (error) throw error;
            if (row.track) removeTrack(row.track);
            if (row.photos && row.photos.length && window.UserPhotos) UserPhotos.remove(row.photos);
            if (window.RouteStatus) RouteStatus.dropRow(key);
            toast('Маршрут убран из каталога');
            return true;
        } catch (e) {
            console.warn('[catalog] снятие с публикации:', e);
            toast('Не удалось убрать маршрут из каталога');
            return false;
        }
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st) close(false); });

    window.CatalogAdmin = {
        PUB, apply, onRouteLoaded, isPublishedSource, publishedKeyOf, unpublish, fmtDur,
        /** Сводка по GPX: километры, набор и время похода, если оно в треке есть. */
        readTrack,
        /** Авторская карточка маршрута каталога (и смена статуса на «пройден»).
         *  Промис — сохранили или закрыли ни с чем. */
        edit(routeInfo, row, status) { return open({ routeInfo, row, status }); },
        /** Свой маршрут — в каталог. */
        publish(routeInfo, row) {
            return open({ routeInfo, row, publish: true, status: (row && row.status) || 'done' });
        },
        isOpen() { return !!st; }
    };
})();
