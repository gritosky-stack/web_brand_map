/**
 * Статусы маршрутов: авторские, «мои», планируемые, пройденные.
 *
 * Три разных статуса, и путать их нельзя:
 *
 * 1. **Авторский статус каталога** — пройден маршрут сайта или только
 *    планируется. Он один на всех (от него цвет метки на карте), правит его
 *    админ, живёт в таблице `catalog_status`. Сами маршруты каталога лежат
 *    файлами в `www/`, в базе их нет — в таблице только переопределение
 *    статуса по ключу (`route_3`).
 * 2. **Личный статус своего маршрута** — колонки `status/planned_at/done_at`
 *    в `routes` (владеет ими account.js, здесь только интерфейс).
 * 3. **Личная отметка чужого маршрута** (каталожного) — строка в
 *    `route_marks`: поменять сам маршрут пользователь не может, а сказать
 *    «я его прошёл» — может.
 *
 * Отсюда же личный счётчик километров: он считается по пройденным **лично**
 * маршрутам, у каждого свой. Гостю счётчик показывает километры команды по
 * авторским маршрутам (`recomputeAuthorKm` в script.js).
 *
 * ⚠️ Права проверяет база, а не эта страница. `is_admin()` здесь спрашивается
 * только затем, чтобы не показывать кнопку, которой всё равно не сработать:
 * RLS в `catalog_status` не пустит чужую запись, даже если кнопку дорисовать
 * руками в консоли.
 *
 * Зависит от script.js (`routes`, `parsedRouteDataCache`, `refreshRouteProps`,
 * `refreshCatalogMenus`, `recomputeAuthorKm`, `setPersonalKm`, `activeFilter`,
 * `setFilter`, `currentViewedRoute`), account.js (`Account.client`,
 * `Account.status`, `MyRoutes.*`), supa.js (`SUPA.rest`) и weather.js
 * (`RouteWeather.describe`).
 */
(function () {
    'use strict';

    const DONE_COLOR = '#ff4d4d';   // авторский пройденный — как в каталоге
    const PLAN_COLOR = '#FF8C00';   // план

    /** Личный статус: подпись, значок, цвет. `mine` — просто «сохранён». */
    const STATUS = {
        mine:    { label: 'В «Моих»',  icon: '📁', color: '#7A5EA6', short: 'Мой' },
        planned: { label: 'Планирую',  icon: '🗓', color: '#FF8C00', short: 'План' },
        done:    { label: 'Пройден',   icon: '✅', color: '#4ADE80', short: 'Пройден' }
    };

    const catalog = new Map();      // route_key → строка catalog_status
    const marks   = new Map();      // route_key → строка route_marks
    let admin = false;
    let marksLoaded = false;
    let busy = false;               // идёт запись — кнопки заблокированы

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const toast = t => (window.MyRoutes ? MyRoutes.toast(t) : console.warn(t));

    /** Сегодня по Белграду: там и маршруты, и прогноз погоды считает эту зону. */
    function todayISO() {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
    }

    function fmtDate(v) {
        if (!v) return '';
        const d = new Date(String(v).length <= 10 ? v + 'T12:00:00' : v);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function fmtTime(v) {
        const d = new Date(v);
        return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function client() {
        return (window.Account && Account.client && Account.client()) || null;
    }

    // ⚠️ `currentViewedRoute`, `routes` и `parsedRouteDataCache` объявлены в
    // script.js через `let`/`const`. Такие имена — глобальные **лексические**
    // привязки: они видны другим файлам по имени, но свойствами `window` не
    // становятся, и `window.currentViewedRoute` всегда `undefined`.
    const viewed = () => (typeof currentViewedRoute !== 'undefined' ? currentViewedRoute : null);
    const catalogRoutes = () => (typeof routes !== 'undefined' ? routes : null);
    const geomCache = () => (typeof parsedRouteDataCache !== 'undefined' ? parsedRouteDataCache : null);

    function signedIn() {
        return !!(window.Account && Account.status && Account.status() === 'signedIn');
    }

    // ── Что мы знаем про маршрут ────────────────────────────────────────────

    /** Свой маршрут — по облачному id, каталожный — по ключу в `routes`. */
    function keyOf(routeInfo) {
        return routeInfo ? routeInfo.id : null;
    }

    /**
     * Личный статус: 'planned' | 'done' | null. У своего маршрута его знает
     * account.js (колонка `status`), у каталожного — отметка `route_marks`.
     * `mine` статусом не считается: в «Планы» и «Пройденные» он не попадает.
     */
    function personalStatusOf(routeInfo) {
        if (!routeInfo) return null;
        if (routeInfo.mine) {
            if (routeInfo.shared) return null;         // чужой маршрут по ссылке
            const st = window.MyRoutes && MyRoutes.statusOf && MyRoutes.statusOf(routeInfo.cloudId);
            return (st === 'planned' || st === 'done') ? st : null;
        }
        const m = marks.get(keyOf(routeInfo));
        return m ? m.status : null;
    }

    /** Дата личного статуса — для подписи в карточке. */
    function personalDateOf(routeInfo) {
        if (!routeInfo) return null;
        if (routeInfo.mine) {
            const row = window.MyRoutes && MyRoutes.rowOf && MyRoutes.rowOf(routeInfo.cloudId);
            if (!row) return null;
            return row.status === 'done' ? row.done_at : row.planned_at;
        }
        const m = marks.get(keyOf(routeInfo));
        if (!m) return null;
        return m.status === 'done' ? m.done_at : m.planned_at;
    }

    function distanceOf(routeInfo) {
        const cache = geomCache();
        const d = cache && cache[routeInfo.id];
        return d && d.distance ? Number(d.distance) : 0;
    }

    function startOf(routeInfo) {
        const cache = geomCache();
        const d = cache && cache[routeInfo.id];
        const c = d && d.coordinates;
        return (c && c.length) ? { lat: c[0][1], lon: c[0][0] } : null;
    }

    // ── Авторский статус каталога ───────────────────────────────────────────

    /**
     * Переопределения статуса из базы — поверх того, что задано в `routesList`.
     * Читают их все, включая гостей: от статуса зависит цвет метки.
     */
    async function loadCatalog() {
        const rows = await SUPA.rest('catalog_status?select=route_key,status,date');
        if (!rows) return;
        catalog.clear();
        rows.forEach(r => catalog.set(r.route_key, r));
        applyCatalog();
    }

    function applyCatalog() {
        const all = catalogRoutes();
        if (!all) return;
        let changed = false;
        catalog.forEach((row, key) => {
            const r = all[key];
            if (!r || r.mine || r.shared) return;
            const future = row.status === 'planned';
            if (!!r.future !== future) {
                r.future = future;
                r.color = future ? PLAN_COLOR : DONE_COLOR;
                changed = true;
            }
            if (row.date && r.date !== row.date) { r.date = row.date; changed = true; }
        });
        if (!changed) return;
        // Поменялся вид маршрута: разделы меню, свойства меток, счётчик и
        // видимость карточек карусели считаются по нему
        if (window.refreshCatalogMenus) refreshCatalogMenus();
        if (window.refreshRouteProps)   refreshRouteProps();
        if (window.recomputeAuthorKm)   recomputeAuthorKm();
        if (window.setFilter && window.activeFilter) setFilter(activeFilter());
        renderPanel(viewed());
    }

    /** Смена авторского статуса. Пустит только админа — проверяет RLS. */
    async function setCatalogStatus(routeKey, status, date) {
        const c = client();
        if (!c) return;
        busy = true; renderPanel(viewed());
        try {
            const row = { route_key: routeKey, status, date: date || null,
                          updated_at: new Date().toISOString() };
            const { error } = await c.from('catalog_status').upsert(row);
            if (error) throw error;
            catalog.set(routeKey, row);
            applyCatalog();
            // applyCatalog перерисует только при смене вида — подпись «изменено»
            // должна появиться и когда статус тот же, а дата другая
            toast(status === 'planned' ? 'Маршрут переведён в планы' : 'Маршрут отмечен пройденным');
        } catch (e) {
            console.warn('[status] авторский статус:', e);
            toast('Не удалось поменять статус. Это может только автор каталога');
        } finally {
            busy = false; renderPanel(viewed());
        }
    }

    // ── Личная отметка каталожного маршрута ─────────────────────────────────

    async function loadMarks() {
        const c = client();
        if (!c || !signedIn()) return;
        try {
            const { data, error } = await c.from('route_marks').select('*');
            if (error) throw error;
            marks.clear();
            (data || []).forEach(r => marks.set(r.route_key, r));
            marksLoaded = true;
            afterChange();
        } catch (e) {
            console.warn('[status] отметки не загрузились:', e);
        }
    }

    /**
     * Поставить или снять личную отметку. `status === null` — снять.
     * Имя и километры пишем копией: список «Пройденные» и счётчик собираются
     * по таблице, без обращения к файлам маршрутов.
     */
    async function setMark(routeInfo, status, dates) {
        const c = client();
        if (!c || !signedIn()) { if (window.Account) Account.openModal(); return; }
        const key = keyOf(routeInfo);
        busy = true; renderPanel(routeInfo);
        try {
            if (!status) {
                const { error } = await c.from('route_marks').delete().eq('route_key', key);
                if (error) throw error;
                marks.delete(key);
            } else {
                // `user_id` явно: первичный ключ здесь составной, и на него
                // опирается upsert. С одним лишь `default auth.uid()` цель
                // `on conflict` пришлось бы угадывать PostgREST
                const row = {
                    user_id: Account.userId(), route_key: key, status,
                    name: routeInfo.name || null,
                    distance_km: distanceOf(routeInfo),
                    planned_at: (dates && dates.plannedAt) || null,
                    done_at: (dates && dates.doneAt) || null,
                    updated_at: new Date().toISOString()
                };
                const { data, error } = await c.from('route_marks').upsert(row).select().single();
                if (error) throw error;
                marks.set(key, data || row);
            }
            afterChange();
        } catch (e) {
            console.warn('[status] отметка:', e);
            toast('Не удалось сохранить отметку');
        } finally {
            busy = false; renderPanel(routeInfo);
        }
    }

    /** Карточки для лент «Планы» и «Пройденные» — отмеченные маршруты каталога. */
    function markedCards(status) {
        return [...marks.values()].filter(m => m.status === status).map(m => ({
            routeId: m.route_key,
            name: m.name || ((catalogRoutes() || {})[m.route_key] || {}).name || 'Маршрут',
            km: m.distance_km || 0,
            date: m.status === 'done' ? m.done_at : m.planned_at,
            catalog: true
        }));
    }

    // ── Личный счётчик километров ───────────────────────────────────────────

    function personalKm() {
        let km = [...marks.values()].reduce((s, m) => s + (m.status === 'done' ? (m.distance_km || 0) : 0), 0);
        if (window.MyRoutes && MyRoutes.doneKm) km += MyRoutes.doneKm();
        return km;
    }

    function refreshKm() {
        if (!window.setPersonalKm) return;
        setPersonalKm(signedIn() ? personalKm() : null);
    }

    /** Что перерисовать после любой смены статуса. */
    function afterChange() {
        if (window.refreshRouteProps) refreshRouteProps();
        refreshKm();
        if (window.MyRoutes && MyRoutes.refreshStrip) MyRoutes.refreshStrip();
        renderPanel(viewed());
    }

    // ── Блок статуса в карточке маршрута ────────────────────────────────────

    function pill(status, active, disabled) {
        const s = STATUS[status];
        const style = active
            ? `background:${s.color}26;border-color:${s.color}99;color:#fff`
            : '';
        return `<button class="rs-pill${active ? ' active' : ''}" data-status="${status}"
                    style="${style}" ${disabled ? 'disabled' : ''}>${s.icon} ${s.label}</button>`;
    }

    function box() { return document.getElementById('panel-status-actions'); }

    function renderPanel(routeInfo) {
        const el = box();
        if (!el) return;
        if (!routeInfo || routeInfo.shared) { el.classList.add('hidden'); el.innerHTML = ''; return; }

        const own  = !!routeInfo.mine;
        const mine = own ? (window.MyRoutes && MyRoutes.statusOf(routeInfo.cloudId)) || 'mine' : null;
        const personal = personalStatusOf(routeInfo);
        const when = personalDateOf(routeInfo);

        el.classList.remove('hidden');

        if (!signedIn()) {
            // Гостю — приглашение, а не молчание: отметка и есть повод войти
            el.innerHTML = `
                <div class="rs-head">Статус</div>
                <button class="tw-btn tw-btn-ghost" id="rs-signin">✅ Отметить пройденным</button>
                <p class="tw-note mt-2">Войдите, чтобы вести свои пройденные и планируемые маршруты —
                   тот же аккаунт, что в приложении.</p>`;
            el.querySelector('#rs-signin').onclick = () => Account.openModal();
            return;
        }

        const rows = [];
        if (own) {
            rows.push(`<div class="rs-head">Мой маршрут · статус</div>
                <div class="rs-pills">
                    ${pill('mine', mine === 'mine', busy)}
                    ${pill('planned', mine === 'planned', busy)}
                    ${pill('done', mine === 'done', busy)}
                </div>`);
        } else {
            rows.push(`<div class="rs-head">Я и этот маршрут</div>
                <div class="rs-pills">
                    ${pill('planned', personal === 'planned', busy)}
                    ${pill('done', personal === 'done', busy)}
                </div>`);
        }

        if (personal && when) {
            const label = personal === 'done' ? 'Пройден' : 'Планируется на';
            const time = personal === 'planned' && String(when).length > 10 ? ', ' + fmtTime(when) : '';
            rows.push(`<div class="rs-when">${label} ${esc(fmtDate(when))}${esc(time)}
                <button class="rs-link" id="rs-edit">изменить</button></div>`);
        } else if (personal) {
            rows.push(`<div class="rs-when">${esc(STATUS[personal].label)}
                <button class="rs-link" id="rs-edit">указать дату</button></div>`);
        }

        if (personal === 'done') {
            rows.push(`<p class="tw-note mt-2">${distanceOf(routeInfo).toFixed(1)} км зачтены
                в ваш счётчик пройденного.</p>`);
        }

        // Авторский статус — только автору каталога
        if (admin && !own) {
            const isPlan = !!routeInfo.future;
            rows.push(`
                <div class="rs-admin">
                    <div class="rs-head">Авторский статус · виден всем</div>
                    <div class="rs-pills">
                        <button class="rs-pill${!isPlan ? ' active' : ''}" data-cat="done"
                            style="${!isPlan ? `background:${DONE_COLOR}26;border-color:${DONE_COLOR}99;color:#fff` : ''}"
                            ${busy ? 'disabled' : ''}>🏔 Пройден</button>
                        <button class="rs-pill${isPlan ? ' active' : ''}" data-cat="planned"
                            style="${isPlan ? `background:${PLAN_COLOR}26;border-color:${PLAN_COLOR}99;color:#fff` : ''}"
                            ${busy ? 'disabled' : ''}>🗓 Планируется</button>
                    </div>
                    <p class="tw-note mt-2">Меняет маршрут в каталоге для всех: цвет метки,
                       раздел меню и вкладку.</p>
                </div>`);
        }

        el.innerHTML = rows.join('');

        el.querySelectorAll('.rs-pill[data-status]').forEach(b => {
            b.onclick = () => onPillClick(routeInfo, b.dataset.status, own);
        });
        el.querySelectorAll('.rs-pill[data-cat]').forEach(b => {
            b.onclick = () => setCatalogStatus(routeInfo.id, b.dataset.cat,
                                              (routeInfo.date || '').slice(0, 10) || null);
        });
        const edit = el.querySelector('#rs-edit');
        if (edit) edit.onclick = () => onPillClick(routeInfo, personal, own, true);
    }

    /**
     * Нажали на статус. Тот же статус второй раз — снимаем (у своего маршрута
     * возвращаем в «Мои», у каталожного убираем отметку). Новый статус с датой
     * спрашиваем модалкой: у плана — когда идём, у пройденного — когда прошли.
     */
    async function onPillClick(routeInfo, status, own, forceAsk) {
        if (busy) return;
        const current = own ? (window.MyRoutes && MyRoutes.statusOf(routeInfo.cloudId)) || 'mine'
                            : personalStatusOf(routeInfo);
        if (!forceAsk && status === current) {
            if (own) { await applyOwn(routeInfo, 'mine', {}); } else { await setMark(routeInfo, null); }
            return;
        }
        if (status === 'mine') { await applyOwn(routeInfo, 'mine', {}); return; }

        const start = startOf(routeInfo);
        const res = await askStatus({
            status, name: routeInfo.name, single: true,
            lat: start && start.lat, lon: start && start.lon,
            when: personalDateOf(routeInfo)
        });
        if (!res) return;
        if (own) await applyOwn(routeInfo, res.status, res);
        else     await setMark(routeInfo, res.status, res);
    }

    async function applyOwn(routeInfo, status, dates) {
        if (!(window.MyRoutes && MyRoutes.setStatus)) return;
        busy = true; renderPanel(routeInfo);
        try {
            await MyRoutes.setStatus(routeInfo.cloudId, status, dates);
        } finally {
            busy = false;
            afterChange();
        }
    }

    // ── Модалка «какой статус» ──────────────────────────────────────────────
    // Ею же встречаем загруженный GPX: человек только что отдал сайту трек,
    // и это ровно тот момент, когда он знает, зачем — «сходил» или «пойду».

    let modalState = null;      // { status, date, time, resolve, opts }
    let wxCache = new Map();

    function ensureModal() {
        let el = document.getElementById('status-modal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'status-modal';
        el.className = 'tw-modal';
        el.innerHTML = '<div class="tw-modal-inner" id="status-modal-inner"></div>';
        el.addEventListener('click', e => { if (e.target === el) closeModal(null); });
        document.body.appendChild(el);
        return el;
    }

    /**
     * @param {object} opts
     *   status  — предвыбранный статус ('mine' | 'planned' | 'done')
     *   name    — название маршрута в заголовке
     *   single  — спрашиваем только дату выбранного статуса, без выбора статуса
     *   lat/lon — старт маршрута: по нему показываем прогноз на выбранный день
     *   when    — уже стоящая дата
     * @returns {Promise<{status, plannedAt, doneAt}|null>}
     */
    function askStatus(opts) {
        const when = opts.when ? String(opts.when) : '';
        return new Promise(resolve => {
            modalState = {
                opts,
                status: opts.status || 'mine',
                date: when.slice(0, 10) || todayISO(),
                time: when.length > 10 ? fmtTime(when) : '09:00',
                resolve
            };
            ensureModal().classList.add('open');
            renderModal();
        });
    }

    function closeModal(result) {
        const el = document.getElementById('status-modal');
        if (el) el.classList.remove('open');
        const st = modalState;
        modalState = null;
        if (st && st.resolve) st.resolve(result);
    }

    function optionRow(status, title, hint) {
        const s = STATUS[status];
        const on = modalState.status === status;
        return `<button class="rs-opt${on ? ' active' : ''}" data-pick="${status}"
                    style="${on ? `border-color:${s.color}99;background:${s.color}1f` : ''}">
                    <span class="rs-opt-icon">${s.icon}</span>
                    <span class="rs-opt-body">
                        <span class="rs-opt-title">${title}</span>
                        <span class="rs-opt-hint">${hint}</span>
                    </span>
                </button>`;
    }

    function renderModal() {
        const inner = document.getElementById('status-modal-inner');
        if (!inner || !modalState) return;
        const st = modalState, o = st.opts;
        const close = `<button class="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" id="rs-x" aria-label="Закрыть">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>`;

        const options = o.single ? '' : `
            <div class="rs-opts">
                ${optionRow('mine', 'Просто сохранить в «Мои»', 'Пусть будет под рукой')}
                ${optionRow('planned', 'В «Планируемые»', 'Дата, время и прогноз погоды')}
                ${optionRow('done', 'В «Пройденные»', 'Дата прохождения и зачёт километров')}
            </div>`;

        let fields = '';
        if (st.status === 'planned') {
            fields = `
                <div class="rs-fields">
                    <label class="rs-field"><span>Дата</span>
                        <input type="date" id="rs-date" class="review-input" value="${esc(st.date)}" min="${todayISO()}"></label>
                    <label class="rs-field"><span>Время старта</span>
                        <input type="time" id="rs-time" class="review-input" value="${esc(st.time)}"></label>
                </div>
                <div id="rs-wx" class="rs-wx"></div>`;
        } else if (st.status === 'done') {
            fields = `
                <div class="rs-fields">
                    <label class="rs-field"><span>Когда прошли</span>
                        <input type="date" id="rs-date" class="review-input" value="${esc(st.date)}" max="${todayISO()}"></label>
                </div>
                <p class="tw-note mt-2">Километры маршрута зачтутся в ваш счётчик пройденного.</p>`;
        }

        inner.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="min-w-0 pr-3">
                    <h3 class="text-white text-base font-semibold">${o.single ? esc(STATUS[st.status].label) : 'Куда определить маршрут?'}</h3>
                    ${o.name ? `<div class="text-zinc-500 text-xs truncate mt-0.5">${esc(o.name)}</div>` : ''}
                </div>
                ${close}
            </div>
            ${options}
            ${fields}
            <div class="flex gap-2 mt-5">
                <button class="tw-btn tw-btn-ghost" id="rs-cancel">Отмена</button>
                <button class="tw-btn tw-btn-mine" id="rs-ok">Готово</button>
            </div>`;

        inner.querySelectorAll('.rs-opt').forEach(b => {
            b.onclick = () => { st.status = b.dataset.pick; renderModal(); };
        });
        inner.querySelector('#rs-x').onclick = () => closeModal(null);
        inner.querySelector('#rs-cancel').onclick = () => closeModal(null);
        inner.querySelector('#rs-ok').onclick = () => {
            const d = inner.querySelector('#rs-date');
            const t = inner.querySelector('#rs-time');
            if (d && d.value) st.date = d.value;
            if (t && t.value) st.time = t.value;
            closeModal(result(st));
        };
        const d = inner.querySelector('#rs-date');
        if (d) d.onchange = () => { st.date = d.value || st.date; renderModal(); };
        const t = inner.querySelector('#rs-time');
        if (t) t.onchange = () => { st.time = t.value || st.time; };
        if (st.status === 'planned') showForecast();
    }

    function result(st) {
        if (st.status === 'planned') {
            const iso = new Date(`${st.date}T${st.time || '09:00'}`);
            return { status: 'planned', plannedAt: isNaN(iso) ? null : iso.toISOString(), doneAt: null };
        }
        if (st.status === 'done') return { status: 'done', plannedAt: null, doneAt: st.date };
        return { status: 'mine', plannedAt: null, doneAt: null };
    }

    /**
     * Прогноз на выбранный день у старта маршрута. Open-Meteo даёт 14 дней —
     * дальше честно пишем, что прогноза пока нет, а не показываем пустоту.
     */
    async function showForecast() {
        const host = document.getElementById('rs-wx');
        const st = modalState;
        if (!host || !st) return;
        const { lat, lon } = st.opts;
        if (lat == null || lon == null) { host.innerHTML = ''; return; }
        const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
        host.innerHTML = '<span class="rs-wx-load">Смотрю прогноз…</span>';
        if (!wxCache.has(key)) {
            const q = new URLSearchParams({
                latitude: lat.toFixed(4), longitude: lon.toFixed(4),
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
                timezone: 'Europe/Belgrade', forecast_days: '14'
            });
            wxCache.set(key, fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
                .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
            wxCache.get(key).catch(() => wxCache.delete(key));
        }
        try {
            const j = await wxCache.get(key);
            if (!modalState || modalState !== st || st.status !== 'planned') return;
            const days = j.daily.time;
            const i = days.indexOf(st.date);
            if (i < 0) {
                host.innerHTML = '<span class="rs-wx-load">Прогноз на этот день ещё не считается — он дальше двух недель</span>';
                return;
            }
            const w = (window.RouteWeather && RouteWeather.describe)
                ? RouteWeather.describe(j.daily.weather_code[i]) : { icon: '🌡', text: '' };
            host.innerHTML = `<span class="rs-wx-icon">${w.icon}</span>
                <span>${esc(w.text)}, ${Math.round(j.daily.temperature_2m_max[i])}°/${Math.round(j.daily.temperature_2m_min[i])}°</span>
                <span class="rs-wx-dim">💧 ${j.daily.precipitation_probability_max[i] ?? 0}% · 💨 ${Math.round(j.daily.wind_speed_10m_max[i])} км/ч</span>`;
        } catch (e) {
            host.innerHTML = '<span class="rs-wx-load">Прогноз сейчас недоступен</span>';
        }
    }

    // ── Запуск ──────────────────────────────────────────────────────────────

    /** Вошли, вышли или приехали маршруты — account.js зовёт это. */
    async function onAccount() {
        if (!signedIn()) {
            admin = false; marks.clear(); marksLoaded = false;
            refreshKm();
            if (window.refreshRouteProps) refreshRouteProps();
            renderPanel(viewed());
            return;
        }
        const c = client();
        if (c && !admin) {
            try {
                const { data } = await c.rpc('is_admin');
                admin = data === true;
            } catch (e) { admin = false; }
        }
        if (!marksLoaded) await loadMarks();
        else afterChange();
    }

    function init() {
        loadCatalog();
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modalState) closeModal(null);
        });
    }

    window.RouteStatus = {
        STATUS, askStatus, renderPanel, personalStatusOf, personalDateOf,
        markedCards, onAccount, refreshKm, personalKm, applyCatalog,
        isAdmin() { return admin; },
        /** Подпись для значка в карточке: «План», «Пройден», «Мой». */
        badgeOf(routeInfo) {
            const st = personalStatusOf(routeInfo);
            return st ? STATUS[st] : null;
        }
    };

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
