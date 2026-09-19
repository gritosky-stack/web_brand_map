/**
 * Аккаунт на сайте и «Мои» маршруты.
 *
 * Это **тот же** аккаунт, что в iOS-приложении: проект Supabase общий
 * (`hikingmap/hikingmap/Supabase.plist`), вход через Google — тот же
 * провайдер Supabase Auth. Разница только в редиректе: приложение ловит
 * `hikingmap://auth-callback`, а сайт возвращается на свой же адрес
 * (`?code=…`, PKCE) — его нужно держать в Redirect URLs панели Supabase.
 *
 * Свои маршруты — таблица `routes` (схема и RLS: `hikingmap/supabase/schema.sql`).
 * `payload` — это `CustomRoute` из приложения как есть, поэтому пишем его
 * в точности теми же полями: `id, name, date, waypointLats, waypointLons,
 * distanceKm, elevations?, updatedAt`. Разрешение конфликтов у приложения —
 * «чья правка свежее» по `updated_at`, поэтому любая правка здесь обязана
 * двигать и колонку, и `payload.updatedAt`.
 *
 * На карте свой маршрут — обычный маршрут из `routes` с `mine: true`
 * (`registerUserRoute` в script.js): та же карточка, профиль, облёт.
 *
 * Зависит от script.js: `parseGPX`, `registerUserRoute`, `unregisterUserRoute`,
 * `triggerRouteSelection`, `setFilter`, `map`, `routes`, `_loadScript`.
 */
(function () {
    'use strict';

    // Anon-ключ публичный по замыслу — тот же, что уезжает в бандле
    // приложения. Данные одного пользователя от другого отделяет RLS.
    const SUPABASE_URL      = 'https://fehspolrnlslzrvjieba.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlaHNwb2xybmxzbHpydmppZWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4Mjg2MjQsImV4cCI6MjEwMjQwNDYyNH0.rk2nNm22oBZ2wot3dM6oI5e6j-WVN0ArWBoSM3nWdW0';
    const SDK               = 'libs/supabase.js';   // ~220 КБ — грузим после карты
    const MINE_COLOR        = '#7A5EA6';
    const ID_PREFIX         = 'my_';
    const RETURN_HASH_KEY   = 'tw-auth-return-hash';

    let client = null;
    let user = null;
    let profileName = null;
    // loading | signedOut | working | signedIn | unavailable
    let state = 'loading';
    let errorMsg = null;
    let filter = 'all';
    const rows = new Map();          // id из облака → строка таблицы routes
    let lastLoad = 0;
    let loadingRoutes = null;
    let hashHandled = false;
    // Удаление аккаунта: idle | confirm | working
    let deleteStep = 'idle';
    const SUPPORT_EMAIL = 'gritosky@gmail.com';

    // ── Утилиты ─────────────────────────────────────────────────────────────

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /**
     * Дата из `payload`. ⚠️ Приложение пишет её **без** часового пояса
     * (`2026-09-21T14:13:20.500` — это UTC, так кодирует supabase-swift), а JS
     * такую строку читает как местное время. Дописываем `Z` сами.
     */
    function parseDate(v) {
        if (v == null) return null;
        const s = String(v);
        const d = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : s + 'Z');
        return isNaN(d) ? null : d;
    }

    function newId() {
        const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 3 | 8)).toString(16);
            });
        return id.toUpperCase();     // как `UUID().uuidString` в приложении
    }

    function haversineKm(aLat, aLon, bLat, bLon) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
        const h = Math.sin(dLat / 2) ** 2 +
                  Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function hasElevations(p) {
        const e = p.elevations;
        return Array.isArray(e) && e.length === (p.waypointLats || []).length && e.some(v => v > 1);
    }

    /** GPX из `payload` — повторяет `CustomRoute.gpxString()` приложения. */
    function gpxString(p, withEle = true) {
        const lats = p.waypointLats || [], lons = p.waypointLons || [];
        const ele = withEle && hasElevations(p) ? p.elevations : null;
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<gpx version="1.1" creator="HikingMap – Totskii Wild" xmlns="http://www.topografix.com/GPX/1/1">\n' +
            `  <trk>\n    <name>${esc(p.name)}</name>\n    <trkseg>`;
        for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
            const e = ele ? `\n        <ele>${Number(ele[i]).toFixed(1)}</ele>` : '';
            xml += `\n      <trkpt lat="${lats[i].toFixed(7)}" lon="${lons[i].toFixed(7)}">${e}\n      </trkpt>`;
        }
        return xml + '\n    </trkseg>\n  </trk>\n</gpx>';
    }

    /** `payload` из GPX-файла — как `CustomRoute.from(gpxData:name:)`. */
    function payloadFromGPX(text, fallbackName) {
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        let pts = xml.getElementsByTagName('trkpt');
        if (!pts.length) pts = xml.getElementsByTagName('rtept');
        if (pts.length < 2) return null;

        const lats = [], lons = [], ele = [];
        for (let i = 0; i < pts.length; i++) {
            const lat = parseFloat(pts[i].getAttribute('lat'));
            const lon = parseFloat(pts[i].getAttribute('lon'));
            if (!isFinite(lat) || !isFinite(lon)) continue;
            const e = pts[i].getElementsByTagName('ele')[0];
            lats.push(lat); lons.push(lon);
            ele.push(e ? parseFloat(e.textContent) : NaN);
        }
        if (lats.length < 2) return null;

        let km = 0;
        for (let i = 1; i < lats.length; i++) km += haversineKm(lats[i - 1], lons[i - 1], lats[i], lons[i]);

        // Пропуски высот заполняем ближайшей известной, как GPXParser —
        // но только если высоты в файле вообще есть
        let elevations = null;
        if (ele.some(v => v > 1)) {
            let last = ele.find(v => isFinite(v));
            elevations = ele.map(v => (isFinite(v) ? (last = v) : last));
        }

        const nameNode = xml.querySelector('trk > name') || xml.querySelector('metadata > name') || xml.querySelector('rte > name');
        const name = (nameNode && nameNode.textContent.trim()) || fallbackName || 'Маршрут';
        const now = new Date().toISOString();
        const p = { id: newId(), name: name.slice(0, 120), date: now,
                    waypointLats: lats, waypointLons: lons, distanceKm: km, updatedAt: now };
        if (elevations) p.elevations = elevations;
        return p;
    }

    // ── Маршрут из облака → маршрут на карте ────────────────────────────────

    function routeIdOf(cloudId) { return ID_PREFIX + cloudId; }

    /**
     * Геометрию и статистику считает тот же `parseGPX`, что у каталога: цифры,
     * раскраска и профиль выходят по тем же правилам.
     */
    function toRouteData(p) {
        if (!p || !Array.isArray(p.waypointLats) || p.waypointLats.length < 2) return null;
        let data;
        try { data = parseGPX(gpxString(p)); } catch (e) { return null; }
        if (!data) return null;
        if (!hasElevations(p)) {
            // Нарисован без рельефа: высот нет — ни профиля, ни набора
            Object.assign(data, { ascent: null, descent: null, minEle: null, maxEle: null,
                                  profile: null, gradeStops: [], peakCoords: null });
        }
        data.photoGeoms = [];
        data._exifDone = true;
        return data;
    }

    function registerRow(row) {
        const p = row.payload || {};
        const data = toRouteData(p);
        row._ok = !!data;
        if (!data) return;
        const recorded = parseDate(p.date) || parseDate(row.recorded_at);
        registerUserRoute({
            id: routeIdOf(row.id), cloudId: row.id, file: null,
            name: p.name || row.name || 'Маршрут', color: MINE_COLOR,
            future: false, mine: true,
            overrideAscent: null, overrideDescent: null, overrideTime: null, overrideMinEle: null,
            date: recorded ? recorded.toISOString() : null,
            description: null, instagramUrl: null, photos: [], videos: []
        }, data);
    }

    function sortedRows() {
        return [...rows.values()].sort((a, b) =>
            (parseDate(b.recorded_at) || 0) - (parseDate(a.recorded_at) || 0));
    }

    // ── Облако ──────────────────────────────────────────────────────────────

    function loadRoutes() {
        if (!client || !user) return Promise.resolve();
        if (loadingRoutes) return loadingRoutes;
        loadingRoutes = (async () => {
            try {
                const { data, error } = await client.from('routes')
                    .select('id,name,distance_km,recorded_at,updated_at,payload');
                if (error) throw error;
                const seen = new Set();
                for (const row of data || []) {
                    seen.add(row.id);
                    const prev = rows.get(row.id);
                    if (prev && prev.updated_at === row.updated_at) continue;
                    rows.set(row.id, row);
                    registerRow(row);
                }
                // Удалённые на другом устройстве
                for (const id of [...rows.keys()]) {
                    if (!seen.has(id)) { rows.delete(id); unregisterUserRoute(routeIdOf(id)); }
                }
                lastLoad = Date.now();
                openFromHash();
            } catch (e) {
                console.warn('[account] маршруты не загрузились:', e);
                toast('Не удалось загрузить ваши маршруты');
            } finally {
                loadingRoutes = null;
                render();
            }
        })();
        return loadingRoutes;
    }

    /** Запись маршрута: колонки для списка + `payload` целиком. */
    async function saveRow(p) {
        const row = {
            id: p.id, name: p.name, distance_km: p.distanceKm || 0,
            recorded_at: parseDate(p.date).toISOString(),
            updated_at: parseDate(p.updatedAt).toISOString(),
            payload: p
        };
        const { data, error } = await client.from('routes').upsert(row).select().single();
        if (error) throw error;
        const saved = data || row;
        rows.set(saved.id, saved);
        registerRow(saved);
        render();
        return saved;
    }

    async function importFiles(fileList) {
        if (!user) { openModal(); return; }
        let lastId = null;
        for (const f of fileList) {
            const p = payloadFromGPX(await f.text(), f.name.replace(/\.gpx$/i, ''));
            if (!p) { toast(`В «${f.name}» нет трека`); continue; }
            try {
                await saveRow(p);
                lastId = p.id;
            } catch (e) {
                console.warn('[account] загрузка GPX:', e);
                toast(`Не удалось сохранить «${p.name}»`);
            }
        }
        if (lastId) showSaved(lastId);
    }

    function showSaved(cloudId) {
        if (filter !== 'mine') setFilter('mine');
        closeModal();
        document.getElementById('mobile-info').classList.add('hidden');
        triggerRouteSelection(routeIdOf(cloudId));
    }

    /**
     * Нарисованный на сайте маршрут (route_builder.js). `beforeShow` — выйти
     * из рисования: пока оно включено, карточку маршрута не открыть.
     */
    async function saveDrawn(p, beforeShow) {
        if (!client || !user) throw new Error('not signed in');
        await saveRow(p);
        if (beforeShow) beforeShow();
        showSaved(p.id);
    }

    async function renameRoute(cloudId, name) {
        const row = rows.get(cloudId);
        name = (name || '').trim().slice(0, 120);
        if (!row || !name || name === row.payload.name) return;
        const p = Object.assign({}, row.payload, { name, updatedAt: new Date().toISOString() });
        try {
            await saveRow(p);
            document.getElementById('panel-name').textContent = name;
        } catch (e) {
            console.warn('[account] переименование:', e);
            toast('Не удалось переименовать');
        }
    }

    async function deleteRoute(cloudId) {
        try {
            const { error } = await client.from('routes').delete().eq('id', cloudId);
            if (error) throw error;
            rows.delete(cloudId);
            unregisterUserRoute(routeIdOf(cloudId));
            render();
        } catch (e) {
            console.warn('[account] удаление:', e);
            toast('Не удалось удалить маршрут');
        }
    }

    function downloadGPX(cloudId) {
        const row = rows.get(cloudId);
        if (!row) return;
        const blob = new Blob([gpxString(row.payload)], { type: 'application/gpx+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (row.payload.name || 'route').replace(/[\\/:*?"<>|]/g, '_') + '.gpx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    /** Ссылка вида `#my_<id>` открывается, как только маршруты приехали. */
    function openFromHash() {
        if (hashHandled) return;
        const id = location.hash.slice(1);
        if (!id.startsWith(ID_PREFIX) || !routes[id]) return;
        hashHandled = true;
        const go = () => triggerRouteSelection(id);
        if (map.getLayer('route-markers-layer')) go(); else map.once('load', go);
    }

    // ── Вход ────────────────────────────────────────────────────────────────

    async function signInWithGoogle() {
        if (!client) return;
        state = 'working'; errorMsg = null; render();
        // Открытый маршрут переживает поездку к Google и обратно
        try { sessionStorage.setItem(RETURN_HASH_KEY, location.hash); } catch (e) {}
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname }
        });
        if (error) { state = 'signedOut'; errorMsg = error.message; render(); }
        // Иначе браузер уже уходит на Google
    }

    /**
     * Удаление аккаунта целиком — функция `delete_my_account` в базе
     * (`hikingmap/supabase/schema.sql`): удаляет того, кто её вызвал, профиль
     * и маршруты уходят каскадом. Клиенту с anon-ключом удалить пользователя
     * из auth.users иначе нечем.
     */
    async function deleteAccount() {
        if (!client || !user || deleteStep === 'working') return;
        deleteStep = 'working'; errorMsg = null; render();
        try {
            const { error } = await client.rpc('delete_my_account');
            if (error) throw error;
        } catch (e) {
            console.warn('[account] удаление аккаунта:', e);
            deleteStep = 'confirm';
            // Функцию в базе ещё не завели — честно говорим, куда писать
            errorMsg = `Не удалось удалить аккаунт. Напишите на ${SUPPORT_EMAIL} — удалим вручную.`;
            render();
            return;
        }
        // Пользователя уже нет — сессию снимаем только у себя
        try { await client.auth.signOut({ scope: 'local' }); } catch (e) {}
        deleteStep = 'idle';
        applySession(null);
        closeModal();
        toast('Аккаунт и все ваши маршруты удалены');
    }

    async function signOut() {
        if (!client) return;
        state = 'working'; render();
        try { await client.auth.signOut(); } catch (e) { console.warn('[account] выход:', e); }
        applySession(null);
    }

    function applySession(session) {
        const next = session && session.user || null;
        if (next && user && next.id === user.id) {    // обновили токен — не событие
            user = next;
            return;
        }
        // Сменился пользователь — чужие маршруты с карты долой
        for (const id of rows.keys()) unregisterUserRoute(routeIdOf(id));
        rows.clear();
        user = next;
        profileName = null;
        state = user ? 'signedIn' : 'signedOut';
        render();
        if (!user) return;

        restoreReturnHash();
        loadProfileName();
        loadRoutes();
    }

    /**
     * Имя для интерфейса. Сперва `profiles.display_name`: имя Apple приходит
     * один раз, при первом входе в приложении, и живёт только там.
     */
    async function loadProfileName() {
        try {
            const { data } = await client.from('profiles')
                .select('display_name').eq('id', user.id).maybeSingle();
            if (data && data.display_name) { profileName = data.display_name; render(); }
        } catch (e) { /* не критично: есть имя из Google */ }
    }

    function accountName() {
        if (!user) return '';
        const m = user.user_metadata || {};
        return profileName || m.full_name || m.name || user.email || 'Профиль';
    }

    function avatarHTML(big) {
        const m = (user && user.user_metadata) || {};
        const url = m.avatar_url || m.picture;
        const cls = 'account-avatar' + (big ? ' lg' : '');
        const letter = esc((accountName().trim()[0] || '?'));
        // Буква лежит под фото: не загрузилось фото — остаётся буква
        const img = url
            ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
            : '';
        return `<span class="${cls}" style="position:relative;overflow:hidden">${letter}${img}</span>`;
    }

    /** Убираем `?code=…` и ошибки OAuth из адреса — ссылкой так не делятся. */
    function cleanUrl() {
        const u = new URL(location.href);
        let dirty = false;
        ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => {
            if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
        });
        if (/(^|[#&])(error|access_token)=/.test(location.hash)) { u.hash = ''; dirty = true; }
        if (dirty) history.replaceState(null, '', u.pathname + u.search + u.hash);
    }

    function readOAuthError() {
        const q = new URLSearchParams(location.search);
        const h = new URLSearchParams(location.hash.slice(1));
        const msg = q.get('error_description') || h.get('error_description');
        if (msg) { errorMsg = msg.replace(/\+/g, ' '); return true; }
        return false;
    }

    function restoreReturnHash() {
        let hash = null;
        try { hash = sessionStorage.getItem(RETURN_HASH_KEY); sessionStorage.removeItem(RETURN_HASH_KEY); } catch (e) {}
        if (hash && !location.hash) {
            history.replaceState(null, '', location.pathname + location.search + hash);
            const id = hash.slice(1);
            if (routes[id] && parsedRouteDataCache[id]) {
                const go = () => triggerRouteSelection(id);
                if (map.getLayer('route-markers-layer')) go(); else map.once('load', go);
            }
        }
    }

    // ── Интерфейс ───────────────────────────────────────────────────────────

    const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    const USER_ICON = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0A17.9 17.9 0 0112 21.75c-2.68 0-5.22-.58-7.5-1.65z"/></svg>';
    const UPLOAD_ICON = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4"/></svg>';

    const PEN_ICON = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.86 4.49l2.65 2.65M4 20l4.2-.9L19.1 8.2a1.9 1.9 0 000-2.65l-.65-.65a1.9 1.9 0 00-2.65 0L4.9 15.8 4 20z"/></svg>';

    function statsLine() {
        const list = sortedRows();
        const km = list.reduce((s, r) => s + (r.distance_km || 0), 0);
        const n = list.length;
        const word = n % 10 === 1 && n % 100 !== 11 ? 'маршрут'
            : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'маршрута' : 'маршрутов';
        return `${n} ${word} · ${km.toFixed(1)} км`;
    }

    function fmtDate(v) {
        const d = parseDate(v);
        return d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    }

    function renderButtons() {
        const show = state !== 'unavailable';
        document.querySelectorAll('.account-btn, .account-sep').forEach(el => el.classList.toggle('hidden', !show));
        const signedIn = state === 'signedIn' && user;
        document.querySelectorAll('.account-btn-nav').forEach(el => {
            el.innerHTML = signedIn
                ? `${avatarHTML(false)}<span class="normal-case tracking-normal max-w-[120px] truncate">${esc(accountName().split(' ')[0])}</span>`
                : 'Войти';
        });
        document.querySelectorAll('.account-btn-row').forEach(el => {
            el.innerHTML = signedIn
                ? `${avatarHTML(false)}<span class="truncate">${esc(accountName())}</span><span class="ml-auto text-zinc-500 text-xs">Профиль</span>`
                : `${USER_ICON}<span>Войти</span><span class="ml-auto text-zinc-500 text-xs">тот же аккаунт, что в приложении</span>`;
        });
    }

    function renderModal() {
        const box = document.getElementById('account-modal-inner');
        if (!box) return;
        const close = `<button class="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" onclick="Account.closeModal()" aria-label="Закрыть">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>`;
        const err = errorMsg ? `<div class="tw-error">${esc(errorMsg)}</div>` : '';

        if (state === 'signedIn' && user) {
            box.innerHTML = `
                <div class="flex items-start justify-between mb-5">
                    <div class="flex items-center gap-3 min-w-0">
                        ${avatarHTML(true)}
                        <div class="min-w-0">
                            <div class="text-white text-base font-medium truncate">${esc(accountName())}</div>
                            <div class="text-zinc-500 text-xs truncate">${esc(user.email || '')}</div>
                        </div>
                    </div>
                    ${close}
                </div>
                <div class="rounded-xl px-4 py-3 mb-4" style="background:rgba(122,94,166,.12);border:1px solid rgba(122,94,166,.35)">
                    <div class="text-[10px] uppercase tracking-widest" style="color:#c4b0e8">Мои маршруты</div>
                    <div class="text-white text-sm mt-1">${loadingRoutes && !rows.size ? 'Загружаю…' : esc(statsLine())}</div>
                </div>
                <div class="flex flex-col gap-2">
                    <button class="tw-btn tw-btn-mine" onclick="Account.showMine()">Показать «Мои» на карте</button>
                    <button class="tw-btn tw-btn-ghost" onclick="RouteBuilder.start()">${PEN_ICON}Нарисовать маршрут</button>
                    <button class="tw-btn tw-btn-ghost" onclick="Account.pickGPX()">${UPLOAD_ICON}Загрузить GPX</button>
                    <button class="tw-btn tw-btn-ghost" onclick="Account.signOut()">Выйти</button>
                </div>
                <p class="tw-note mt-4">Это тот же профиль, что в приложении TOTSKII Wild: маршруты, записанные
                   или нарисованные в телефоне, появляются здесь, а загруженные здесь — в приложении.</p>
                ${deleteBlock()}
                ${err}`;
            return;
        }

        const busy = state === 'working' || state === 'loading';
        box.innerHTML = `
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-white text-base font-semibold">Профиль</h3>
                ${close}
            </div>
            <p class="tw-note mb-5">Войдите тем же аккаунтом, что и в приложении TOTSKII Wild — ваши
               маршруты появятся во вкладке «Мои» и здесь, и в телефоне.</p>
            <button class="tw-btn tw-btn-google" onclick="Account.signInWithGoogle()" ${busy ? 'disabled' : ''}>
                ${GOOGLE_G}${state === 'working' ? 'Открываю Google…' : 'Войти через Google'}
            </button>
            <p class="tw-note mt-4" style="font-size:11px">Входя, вы принимаете <a href="terms.html" style="text-decoration:underline">условия использования</a>
               и <a href="privacy.html" style="text-decoration:underline">политику конфиденциальности</a>.</p>
            ${state === 'unavailable' ? '<div class="tw-error">Сервис входа сейчас недоступен</div>' : err}`;
    }

    /** Удаление аккаунта — в два шага, без системного confirm() */
    function deleteBlock() {
        if (deleteStep === 'idle') {
            return `<button class="tw-delete-link" onclick="Account.askDelete()">Удалить аккаунт</button>`;
        }
        const n = rows.size;
        const routesWord = n % 10 === 1 && n % 100 !== 11 ? 'маршрут'
            : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'маршрута' : 'маршрутов';
        const working = deleteStep === 'working';
        return `
            <div class="tw-delete-box">
                <div class="text-white text-sm font-semibold mb-1">Удалить аккаунт?</div>
                <p class="tw-note">Удалятся профиль и ${n ? `все ваши маршруты (${n} ${routesWord})` : 'все ваши маршруты'} —
                   и здесь, и в приложении. Отменить это нельзя. Если маршруты нужны, сначала скачайте их в GPX.</p>
                <div class="flex gap-2 mt-3">
                    <button class="tw-btn tw-btn-ghost" onclick="Account.cancelDelete()" ${working ? 'disabled' : ''}>Отмена</button>
                    <button class="tw-btn tw-btn-danger" onclick="Account.confirmDelete()" ${working ? 'disabled' : ''}>
                        ${working ? 'Удаляю…' : 'Удалить навсегда'}</button>
                </div>
            </div>`;
    }

    /** Миниатюра трека для карточки — чтобы маршруты различались без фото. */
    function miniLine(p) {
        const lats = p.waypointLats || [], lons = p.waypointLons || [];
        if (lats.length < 2) return '';
        const step = Math.max(1, Math.floor(lats.length / 80));
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const pts = [];
        for (let i = 0; i < lats.length; i += step) {
            const x = lons[i] * Math.cos(lats[0] * Math.PI / 180), y = -lats[i];
            pts.push([x, y]);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        const w = maxX - minX || 1e-6, h = maxY - minY || 1e-6, s = Math.min(100 / w, 60 / h);
        const ox = (100 - w * s) / 2, oy = (60 - h * s) / 2;
        const d = pts.map(([x, y]) => `${(ox + (x - minX) * s).toFixed(1)},${(oy + (y - minY) * s).toFixed(1)}`).join(' ');
        return `<svg class="my-card-line" viewBox="-4 -4 108 68" preserveAspectRatio="xMidYMid meet"><polyline points="${d}" fill="none" stroke="${MINE_COLOR}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
    }

    function renderStrip() {
        const strip = document.getElementById('my-routes-strip');
        if (!strip) return;
        if (state !== 'signedIn') {
            strip.innerHTML = `<button class="my-card my-card-add" onclick="Account.openModal()">
                ${USER_ICON}<span>Войдите, чтобы видеть свои маршруты из приложения</span></button>`;
            return;
        }
        const cards = sortedRows().filter(r => r._ok).map(r => `
            <button class="my-card" onclick="flyToRoute('${routeIdOf(esc(r.id))}')" title="${esc(r.payload.name)}">
                ${miniLine(r.payload)}
                <div class="my-card-body">
                    <div class="my-card-name">${esc(r.payload.name || r.name)}</div>
                    <div class="my-card-meta">${(r.distance_km || 0).toFixed(1)} км · ${esc(fmtDate(r.recorded_at))}</div>
                </div>
            </button>`).join('');
        const empty = !cards && !loadingRoutes
            ? `<div class="my-card my-card-add" style="cursor:default;border-style:solid">Здесь появятся маршруты, записанные или нарисованные в приложении</div>` : '';
        strip.innerHTML = `<button class="my-card my-card-add" onclick="RouteBuilder.start()">${PEN_ICON}<span>Нарисовать</span></button>` +
            `<button class="my-card my-card-add" onclick="Account.pickGPX()">${UPLOAD_ICON}<span>Загрузить GPX</span></button>${cards}${empty}`;
    }

    function renderMobileList() {
        const box = document.getElementById('mobile-my-routes');
        const all = document.getElementById('mobile-all-tours');
        if (!box) return;
        const visible = filter === 'mine' || (filter === 'all' && rows.size > 0);
        box.classList.toggle('hidden', !visible);
        if (all) all.classList.toggle('hidden', filter === 'mine');
        if (!visible) return;

        const head = `<div class="text-[10px] mb-3 tracking-widest border-b border-white/10 pb-2" style="color:#c4b0e8">Мои маршруты</div>`;
        if (state !== 'signedIn') {
            box.innerHTML = head + `<button class="tw-btn tw-btn-google" onclick="Account.signInWithGoogle()">${GOOGLE_G}Войти через Google</button>
                <p class="tw-note normal-case tracking-normal font-normal mt-3">Тот же аккаунт, что в приложении.</p>`;
            return;
        }
        const list = sortedRows().filter(r => r._ok).map(r => `
            <button class="my-row" onclick="document.getElementById('mobile-info').classList.add('hidden');flyToRoute('${routeIdOf(esc(r.id))}')">
                <span style="width:8px;height:8px;border-radius:50%;background:${MINE_COLOR};flex-shrink:0"></span>
                <span class="truncate">${esc(r.payload.name || r.name)}</span>
                <span class="my-row-meta">${(r.distance_km || 0).toFixed(1)} км</span>
            </button>`).join('');
        box.innerHTML = head + `<div class="flex flex-col gap-4 pl-2">${list ||
            (loadingRoutes ? '' : '<p class="tw-note normal-case tracking-normal font-normal">Пока пусто: маршруты из приложения появятся здесь.</p>')}</div>
            <button class="tw-btn tw-btn-ghost mt-4 normal-case tracking-normal" onclick="RouteBuilder.start()">${PEN_ICON}Нарисовать маршрут</button>
            <button class="tw-btn tw-btn-ghost mt-2 normal-case tracking-normal" onclick="Account.pickGPX()">${UPLOAD_ICON}Загрузить GPX</button>`;
    }

    function renderLegend() {
        const el = document.getElementById('legend-mine');
        if (el) el.style.display = rows.size ? '' : 'none';
    }

    let lastAnnounced = null;
    function announce() {
        if (state === lastAnnounced) return;
        lastAnnounced = state;
        document.dispatchEvent(new CustomEvent('tw-account', { detail: { state } }));
    }

    function render() {
        announce();
        renderButtons();
        renderModal();
        renderStrip();
        renderMobileList();
        renderLegend();
    }

    /** Действия в карточке своего маршрута: переименовать, скачать, удалить. */
    function renderPanelActions(routeInfo) {
        const box = document.getElementById('panel-my-actions');
        if (!box) return;
        if (!routeInfo || !routeInfo.mine) { box.classList.add('hidden'); box.innerHTML = ''; return; }
        const id = routeInfo.cloudId;
        box.classList.remove('hidden');
        box.innerHTML = `
            <div class="text-zinc-500 text-[10px] uppercase tracking-widest mb-3">Мой маршрут</div>
            <div id="my-rename" class="hidden mb-2 flex gap-2">
                <input class="review-input" maxlength="120" id="my-rename-input">
                <button class="tw-btn tw-btn-mine" style="width:auto" id="my-rename-save">OK</button>
            </div>
            <div class="flex flex-col gap-2">
                <button class="tw-btn tw-btn-ghost" id="my-act-rename">Переименовать</button>
                <button class="tw-btn tw-btn-ghost" id="my-act-gpx">Скачать GPX</button>
                <button class="tw-btn tw-btn-danger" id="my-act-delete">Удалить</button>
            </div>
            <p class="tw-note mt-3">Изменения сразу уходят в приложение.</p>`;

        const input = box.querySelector('#my-rename-input');
        const save = () => { renameRoute(id, input.value); box.querySelector('#my-rename').classList.add('hidden'); };
        box.querySelector('#my-act-rename').onclick = () => {
            const row = rows.get(id);
            input.value = row ? row.payload.name : routeInfo.name;
            box.querySelector('#my-rename').classList.remove('hidden');
            input.focus(); input.select();
        };
        box.querySelector('#my-rename-save').onclick = save;
        input.onkeydown = e => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') box.querySelector('#my-rename').classList.add('hidden');
        };
        box.querySelector('#my-act-gpx').onclick = () => downloadGPX(id);

        // Удаление — в два нажатия, без системного confirm()
        const del = box.querySelector('#my-act-delete');
        let armed = null;
        del.onclick = () => {
            if (armed) { clearTimeout(armed); del.disabled = true; del.textContent = 'Удаляю…'; deleteRoute(id); return; }
            del.textContent = 'Точно удалить? Нажмите ещё раз';
            armed = setTimeout(() => { armed = null; del.textContent = 'Удалить'; }, 3500);
        };
    }

    let toastTimer = null;
    function toast(text) {
        let el = document.getElementById('tw-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'tw-toast';
            el.style.cssText = 'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:130;' +
                'background:rgba(15,15,17,.95);border:1px solid rgba(63,63,70,.6);color:#fff;font-size:13px;' +
                'padding:10px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.6);transition:opacity .3s;max-width:90vw';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
    }

    function openModal() {
        renderModal();
        document.getElementById('account-modal').classList.add('open');
        document.getElementById('mobile-info').classList.add('hidden');
    }
    function closeModal() {
        document.getElementById('account-modal').classList.remove('open');
        errorMsg = null;
        if (deleteStep === 'confirm') deleteStep = 'idle';
    }

    function pickGPX() {
        if (!user) { openModal(); return; }
        document.getElementById('my-gpx-input').click();
    }

    /**
     * Ленту листают колесом и мышью, как карусель каталога. Сама по себе она
     * прокручивается только тачпадом вбок или Shift+колесо — обычной мышью
     * дальше первых карточек было не уйти.
     */
    function makeStripScrollable(strip) {
        if (!strip) return;
        strip.addEventListener('wheel', e => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // тачпад вбок — сам
            if (strip.scrollWidth <= strip.clientWidth) return;
            e.preventDefault();
            strip.scrollLeft += e.deltaY;
        }, { passive: false });

        // Перетаскивание. Сдвинули дальше 5 px — это прокрутка, и клик по
        // карточке под пальцем не открывает маршрут
        let startX = 0, startScroll = 0, dragging = false, moved = false;
        strip.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true; moved = false;
            startX = e.clientX; startScroll = strip.scrollLeft;
        });
        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            if (!moved && Math.abs(dx) > 5) { moved = true; strip.style.cursor = 'grabbing'; }
            if (moved) { e.preventDefault(); strip.scrollLeft = startScroll - dx; }
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            strip.style.cursor = '';
        });
        strip.addEventListener('click', e => {
            if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
        }, true);
        strip.addEventListener('dragstart', e => e.preventDefault());
    }

    // ── Запуск ──────────────────────────────────────────────────────────────

    async function init() {
        // В Capacitor-обёртке Google не пускает вход во встроенном WebView —
        // там есть нативное приложение, входить нужно в нём
        if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
            state = 'unavailable'; render(); return;
        }
        const input = document.getElementById('my-gpx-input');
        input.addEventListener('change', () => {
            const files = [...input.files];
            input.value = '';
            if (files.length) importFiles(files);
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
        makeStripScrollable(document.getElementById('my-routes-strip'));

        const hadError = readOAuthError();
        render();

        try {
            await _loadScript(SDK);
        } catch (e) {
            state = 'unavailable'; render(); return;
        }
        client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
        });
        // ⚠️ Внутри колбэка нельзя ждать других вызовов клиента: SDK держит
        // блокировку сессии, и запрос к базе отсюда повисает навсегда
        client.auth.onAuthStateChange((event, session) => {
            setTimeout(() => {
                applySession(session);
                cleanUrl();
            }, 0);
        });
        if (hadError) { cleanUrl(); openModal(); }

        // Маршрут, записанный в телефоне, подтягиваем, когда вкладка снова
        // на экране — без realtime-подписки
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && user && Date.now() - lastLoad > 30000) loadRoutes();
        });
    }

    window.Account = {
        openModal, closeModal, signInWithGoogle, signOut, pickGPX,
        showMine() { closeModal(); setFilter('mine'); },
        askDelete() { deleteStep = 'confirm'; errorMsg = null; renderModal(); },
        cancelDelete() { deleteStep = 'idle'; errorMsg = null; renderModal(); },
        confirmDelete: deleteAccount,
        /** loading | signedOut | working | signedIn | unavailable */
        status() { return state === 'signedIn' && !user ? 'signedOut' : state; }
    };
    window.MyRoutes = {
        onFilterChange(type) { filter = type; renderMobileList(); },
        renderPanelActions, saveDrawn, toast
    };

    // Карта и каталог важнее: SDK и сессию поднимаем, когда страница встала
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
