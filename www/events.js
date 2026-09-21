/**
 * События: «идём туда-то тогда-то». Маршрут, дата, лидеры и участники,
 * внутри чат и чек-лист сборов с ответственными.
 *
 * Открывается по ссылке `#e/<uuid>` — её кидают в чат, и пришедший видит
 * карточку до вступления: маршрут, дату, кто идёт.
 *
 * ⚠️ Права решает база. Карточку, список участников и переписку отдают
 * функции с правами владельца (`get_event`, `my_events`, `event_feed`):
 * участнику нужны **имена** других участников, а чужой профиль RLS ему
 * читать не даёт. Писать при этом можно только в свои таблицы и только
 * участником — политики в `hikingmap/supabase/schema.sql`.
 *
 * ⚠️ Чат опрашивается раз в 6 секунд, а не через realtime-подписку.
 * Postgres Changes у Supabase требуют отдельной настройки публикации и
 * реплики, а для сборов в поход шесть секунд — не задержка. Запрос
 * инкрементальный (`after_id`), то есть это одна строка JSON на опрос.
 *
 * Зависит от account.js (`Account.client/userId/status`), script.js
 * (`routes`, `parsedRouteDataCache`, `triggerRouteSelection`) и MyRoutes.toast.
 */
(function () {
    'use strict';

    const HASH = '#e/';
    const POLL_MS = 6000;

    let list = [];               // my_events
    let stack = [];              // экраны: {kind:'list'|'event'|'edit', id?, data?, tab?}
    let messages = [];
    let lastId = 0;
    let pollTimer = null;
    let busy = false;
    let loadedFor = null;
    let draft = null;            // форма события

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const toast = t => (window.MyRoutes ? MyRoutes.toast(t) : console.warn(t));
    const client = () => (window.Account && Account.client && Account.client()) || null;
    const uid = () => (window.Account && Account.userId && Account.userId()) || null;
    const signedIn = () => !!(window.Account && Account.status && Account.status() === 'signedIn');

    function svg(d, size) {
        return `<svg width="${size || 14}" height="${size || 14}" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    }
    const ICON = {
        close: 'M6 18L18 6M6 6l12 12',
        back:  'M15 19l-7-7 7-7',
        plus:  'M12 5v14M5 12h14',
        cal:   'M8 3v3m8-3v3M4 9h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z',
        pin:   'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
        users: 'M17 20h5v-1a4 4 0 00-3-3.87M9 20H2v-1a5 5 0 016.3-4.83M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
        chat:  'M8 12h8m-8-4h5M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z',
        pack:  'M9 6V5a3 3 0 016 0v1m-9 0h12l1 14H5L6 6z',
        check: 'M5 13l4 4L19 7',
        link:  'M13.8 10.2a4 4 0 010 5.7l-2.1 2.1a4 4 0 01-5.7-5.7l1-1m5.2-1.4l1-1a4 4 0 115.7 5.7l-2.1 2.1',
        route: 'M4 19h6a3 3 0 003-3V9a3 3 0 013-3h4m0 0l-3-3m3 3l-3 3',
        send:  'M4 12l16-8-6 16-2-6-8-2z',
        trash: 'M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13'
    };

    const top = () => stack[stack.length - 1] || null;

    function eventLink(id) {
        return location.origin + location.pathname + HASH + id;
    }

    const dayOf  = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const timeOf = d => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    /**
     * «4 октября, 07:10 → 18:30» или, если поход с ночёвкой, «4 октября,
     * 07:10 → 5 октября, 16:00». Поход — это отрезок времени от сбора до
     * возвращения, а не одна отметка (фидбэк 2026-09-21).
     */
    function fmtWhen(a, b) {
        const s = a ? new Date(a) : null;
        if (!s || isNaN(s)) return 'дата не назначена';
        const e = b ? new Date(b) : null;
        if (!e || isNaN(e)) return `${dayOf(s)}, ${timeOf(s)}`;
        const sameDay = s.toDateString() === e.toDateString();
        return sameDay ? `${dayOf(s)}, ${timeOf(s)} → ${timeOf(e)}`
                       : `${dayOf(s)}, ${timeOf(s)} → ${dayOf(e)}, ${timeOf(e)}`;
    }

    /**
     * Сколько похода по часам — чтобы подсказать окончание, а не заставлять
     * считать. Те же 4.5 км/ч и 4.3 м набора в минуту, что в `HikingTime`
     * (`time_planner.js`), плюс час на привалы.
     */
    function estimateHours(routeKey) {
        if (!routeKey || typeof routes === 'undefined' || !routes[routeKey]) return null;
        const r = routes[routeKey];
        const m = /(\d+)\s*h(?:\s*(\d+)\s*m)?/i.exec(r.overrideTime || '');
        if (m) return +m[1] + (m[2] ? +m[2] / 60 : 0);
        const d = (typeof parsedRouteDataCache !== 'undefined') && parsedRouteDataCache[routeKey];
        if (!d || !d.distance) return null;
        const asc = r.overrideAscent != null ? r.overrideAscent : (d.ascent || 0);
        return d.distance / 4.5 + asc / 258 + 1;
    }

    /** Для `datetime-local`: он не понимает ни `Z`, ни смещения. */
    function toLocalInput(v) {
        const d = v ? new Date(v) : null;
        if (!d || isNaN(d)) return '';
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function plural(n, one, few, many) {
        return n % 10 === 1 && n % 100 !== 11 ? one
            : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
    }

    function avatar(url, name) {
        const letter = esc(((name || '?').trim()[0] || '?'));
        return url ? `<img class="ev-ava" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
                   : `<span class="ev-ava">${letter}</span>`;
    }

    // ── Данные ──────────────────────────────────────────────────────────────

    async function loadList(force) {
        const c = client();
        if (!c || !signedIn()) { list = []; loadedFor = null; return; }
        if (loadedFor === uid() && !force) return;
        loadedFor = uid();
        try {
            const { data } = await c.rpc('my_events');
            list = data || [];
        } catch (e) {
            console.warn('[events] список:', e);
        }
        render();
        if (window.Account && Account.refreshButtons) Account.refreshButtons();
    }

    async function fetchEvent(id) {
        const c = client();
        if (!c) return { state: 'error' };
        try {
            const { data, error } = await c.rpc('get_event', { ev: id });
            if (error) throw error;
            return data || { state: 'not_found' };
        } catch (e) {
            console.warn('[events] карточка:', e);
            return { state: 'error' };
        }
    }

    async function pullFeed(id, reset) {
        const c = client();
        if (!c) return;
        if (reset) { messages = []; lastId = 0; }
        try {
            const { data } = await c.rpc('event_feed', { ev: id, after_id: lastId });
            const fresh = data || [];
            if (fresh.length) {
                messages = messages.concat(fresh);
                lastId = fresh[fresh.length - 1].id;
                const t = top();
                if (t && t.kind === 'event' && t.tab === 'chat') { renderChat(); scrollChat(); }
            }
        } catch (e) { /* сеть моргнула — следующий опрос догонит */ }
    }

    function startPoll(id) {
        stopPoll();
        pollTimer = setInterval(() => {
            const t = top();
            if (!t || t.kind !== 'event' || t.id !== id) { stopPoll(); return; }
            pullFeed(id);
        }, POLL_MS);
    }

    function stopPoll() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    // ── Экраны ──────────────────────────────────────────────────────────────

    function host() { return document.getElementById('events-modal'); }

    function ensureModal() {
        let el = host();
        if (el) return el;
        el = document.createElement('div');
        el.id = 'events-modal';
        el.className = 'tw-modal';
        el.innerHTML = '<div class="tw-modal-inner ev-inner" id="events-modal-inner"></div>';
        el.addEventListener('click', e => { if (e.target === el) close(); });
        document.body.appendChild(el);
        return el;
    }

    function show() {
        ensureModal().classList.add('open');
        const acc = document.getElementById('account-modal');
        if (acc) acc.classList.remove('open');
        const mob = document.getElementById('mobile-info');
        if (mob) mob.classList.add('hidden');
    }

    function push(entry) { stack.push(entry); show(); render(); }

    function back() {
        stopPoll();
        if (stack.length > 1) { stack.pop(); render(); const t = top();
            if (t && t.kind === 'event') { messages = []; lastId = 0; openEvent(t.id, true); } }
        else close();
    }

    function close() {
        stopPoll();
        const el = host();
        if (el) el.classList.remove('open');
        stack = [];
        messages = []; lastId = 0; draft = null;
        if (location.hash.startsWith(HASH)) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }

    function open() {
        stack = [{ kind: 'list' }];
        show();
        render();
        loadList(true);
    }

    async function openEvent(id, replace) {
        const entry = { kind: 'event', id, data: null, tab: 'info' };
        if (replace && top() && top().kind === 'event') stack[stack.length - 1] = entry;
        else push(entry);
        show();
        render();
        const c = client();
        if (!c) {
            if ((openEvent._tries = (openEvent._tries || 0) + 1) > 12) {
                entry.data = { state: 'error' }; render(); return;
            }
            setTimeout(() => { if (top() === entry && !entry.data) openEvent(id, true); }, 600);
            return;
        }
        openEvent._tries = 0;
        entry.data = await fetchEvent(id);
        if (top() !== entry) return;
        render();
        if (entry.data.state === 'ok' && entry.data.my_role) {
            await pullFeed(id, true);
            startPoll(id);
        }
    }

    function render() {
        const el = host();
        if (!el || !el.classList.contains('open')) return;
        const t = top();
        if (!t) { close(); return; }
        if (t.kind === 'list')  return renderList();
        if (t.kind === 'edit')  return renderEdit();
        return renderEvent(t);
    }

    function head(title, extra) {
        return `<div class="ev-head">
            ${stack.length > 1 ? `<button class="pf-x" id="ev-back" aria-label="Назад">${svg(ICON.back, 16)}</button>` : '<span></span>'}
            <div class="ev-head-t">${esc(title)}</div>
            ${extra || ''}
            <button class="pf-x" id="ev-close" aria-label="Закрыть">${svg(ICON.close, 16)}</button>
        </div>`;
    }

    // ── Список моих событий ─────────────────────────────────────────────────

    function renderList() {
        const box = document.getElementById('events-modal-inner');
        if (!box) return;
        if (!signedIn()) {
            box.innerHTML = head('События') +
                `<div class="ev-body"><div class="pf-empty">Войдите, чтобы собирать походы и присоединяться к чужим.</div></div>`;
            return wire(box);
        }
        const cards = list.map(e => `
            <button class="ev-card" data-ev="${esc(e.id)}">
                <div class="ev-card-t">${esc(e.title)}</div>
                <div class="ev-card-m">
                    <span>${svg(ICON.cal, 11)}${esc(fmtWhen(e.starts_at, e.ends_at))}</span>
                    ${e.route_name ? `<span>${svg(ICON.route, 11)}${esc(e.route_name)}${
                        e.route_km ? ` · ${Number(e.route_km).toFixed(1)} км` : ''}</span>` : ''}
                    <span>${svg(ICON.users, 11)}${e.members} ${plural(e.members, 'участник', 'участника', 'участников')}</span>
                </div>
                ${e.my_role === 'leader' ? '<span class="ev-role">лидер</span>' : ''}
            </button>`).join('');
        box.innerHTML = head('Мои события') + `<div class="ev-body">
            <button class="pf-btn pf-btn-accent ev-wide" id="ev-new">${svg(ICON.plus, 14)}Собрать поход</button>
            ${cards ? `<div class="ev-cards">${cards}</div>` : `<div class="pf-empty">Пока ни одного похода.<br>
                <span class="pf-note">Соберите свой — или попросите ссылку у того, кто уже собрал.</span></div>`}
        </div>`;
        wire(box);
    }

    // ── Карточка события ────────────────────────────────────────────────────

    function tabBar(entry) {
        const t = entry.tab;
        const n = entry.data.messages_count || 0;
        const items = entry.data.items || [];
        const left = items.filter(i => !i.done).length;
        return `<div class="ev-tabs">
            <button class="ev-tab${t === 'info' ? ' active' : ''}" data-tab="info">${svg(ICON.pin, 12)}Поход</button>
            <button class="ev-tab${t === 'chat' ? ' active' : ''}" data-tab="chat">${svg(ICON.chat, 12)}Чат${
                n ? ` <b>${n}</b>` : ''}</button>
            <button class="ev-tab${t === 'gear' ? ' active' : ''}" data-tab="gear">${svg(ICON.pack, 12)}Сборы${
                left ? ` <b>${left}</b>` : ''}</button>
        </div>`;
    }

    function renderEvent(entry) {
        const box = document.getElementById('events-modal-inner');
        if (!box) return;
        const e = entry.data;
        if (!e) { box.innerHTML = head('Поход') + '<div class="ev-body"><div class="pf-empty">Открываю…</div></div>'; return wire(box); }
        if (e.state === 'not_found') {
            box.innerHTML = head('Поход') + `<div class="ev-body"><div class="pf-empty">
                Такого похода нет — возможно, его отменили.</div></div>`;
            return wire(box);
        }
        if (e.state === 'closed') {
            box.innerHTML = head('Поход') + `<div class="ev-body"><div class="pf-empty">
                Этот поход открыт только друзьям того, кто его собрал.</div></div>`;
            return wire(box);
        }
        if (e.state !== 'ok') {
            box.innerHTML = head('Поход') + `<div class="ev-body"><div class="pf-empty">
                Не удалось открыть. Попробуйте позже.</div></div>`;
            return wire(box);
        }

        const isLeader = e.my_role === 'leader';
        const isMember = !!e.my_role;
        const body = [];

        if (entry.tab === 'info') {
            body.push(`<div class="ev-when">${svg(ICON.cal, 13)}<span>${esc(fmtWhen(e.starts_at, e.ends_at))}</span></div>`);
            if (e.route_key) {
                body.push(`<button class="ev-route" id="ev-route">
                    ${svg(ICON.route, 15)}
                    <span class="ev-route-t">${esc(e.route_name || 'Маршрут')}${
                        e.route_km ? `<em>${Number(e.route_km).toFixed(1)} км</em>` : ''}</span>
                    <span class="ev-route-go">на карте</span>
                </button>`);
            }
            if (e.meeting || e.meet_lat != null) {
                body.push(`<div class="ev-line">${svg(ICON.pin, 13)}
                    <span>Сбор: ${esc(e.meeting || 'точка на карте')}</span>
                    ${e.meet_lat != null ? `<button class="pf-link" id="ev-meet-show">на карте</button>` : ''}
                </div>`);
            }
            if (e.description) body.push(`<p class="ev-desc">${esc(e.description)}</p>`);

            body.push(`<div class="pf-sec"><div class="pf-sec-h">Кто идёт <em>${e.members.length}</em></div>
                <div class="ev-people">${e.members.map(m => `
                    <div class="ev-person">
                        ${avatar(m.avatar_url, m.display_name)}
                        <span class="ev-person-n">${esc(m.display_name || (m.username ? '@' + m.username : 'Без имени'))}</span>
                        ${m.role === 'leader' ? '<span class="ev-role">лидер</span>' : ''}
                        ${isLeader && m.id !== e.owner ? `
                            <span class="ev-person-a">
                                <button class="pf-link" data-role="${esc(m.id)}" data-to="${m.role === 'leader' ? 'member' : 'leader'}"
                                    >${m.role === 'leader' ? 'снять лидера' : 'сделать лидером'}</button>
                                <button class="pf-link" data-kick="${esc(m.id)}">убрать</button>
                            </span>` : ''}
                    </div>`).join('')}</div></div>`);

            if (!isMember) {
                body.push(`<button class="pf-btn pf-btn-accent ev-wide" id="ev-join">${svg(ICON.plus, 14)}Я иду</button>
                    <p class="pf-note">Вступив, вы увидите чат и список сборов.</p>`);
            } else {
                body.push(`<div class="pf-sec"><div class="pf-sec-h">Ссылка на поход</div>
                    <div class="pf-linkbox">
                        <input class="review-input" id="ev-link" readonly value="${esc(eventLink(e.id))}">
                        <button class="pf-btn pf-btn-ghost" id="ev-copy">${svg(ICON.link, 14)}Копировать</button>
                    </div>
                    <p class="pf-note">${e.visibility === 'friends'
                        ? 'Присоединиться смогут только друзья того, кто собрал поход.'
                        : 'Присоединиться сможет любой, у кого есть ссылка.'}</p></div>`);
                const foot = [];
                if (isLeader) foot.push(`<button class="pf-btn pf-btn-ghost" id="ev-edit">Изменить</button>`);
                if (e.owner === uid()) foot.push(`<button class="pf-btn pf-btn-danger" id="ev-delete">Отменить поход</button>`);
                else foot.push(`<button class="pf-btn pf-btn-ghost" id="ev-leave">Я не иду</button>`);
                body.push(`<div class="pf-foot">${foot.join('')}</div>`);
            }
        } else if (entry.tab === 'chat') {
            body.push(`<div class="ev-chat" id="ev-chat"></div>
                <form class="ev-send" id="ev-send">
                    <input class="review-input" id="ev-msg" maxlength="1000" autocomplete="off"
                           placeholder="Написать участникам…">
                    <button class="pf-btn pf-btn-accent" type="submit" aria-label="Отправить">${svg(ICON.send, 15)}</button>
                </form>`);
        } else {
            const items = e.items || [];
            const mine = items.filter(i => i.assignee === uid() && !i.done).length;
            body.push(`<p class="pf-note" style="margin-top:0">Общее снаряжение: кто что берёт.
                Отметьте пункт, когда вещь <b>собрана и лежит в рюкзаке</b>.</p>`);
            if (mine) body.push(`<div class="ev-mine">${svg(ICON.pack, 13)}
                <span>На вас ${mine} ${plural(mine, 'пункт', 'пункта', 'пунктов')} — ещё не отмечено</span></div>`);
            body.push(`<div class="ev-items">${items.map(i => itemRow(i, e)).join('')
                || '<div class="pf-none">Список пуст. Добавьте первое — палатку, горелку, аптечку.</div>'}</div>
                <form class="ev-send" id="ev-add">
                    <input class="review-input" id="ev-item" maxlength="120" autocomplete="off"
                           placeholder="Что взять: палатка, горелка, аптечка…">
                    <button class="pf-btn pf-btn-accent" type="submit" aria-label="Добавить">${svg(ICON.plus, 15)}</button>
                </form>`);
        }

        box.innerHTML = head(e.title) + (isMember ? tabBar(entry) : '') +
            `<div class="ev-body">${body.join('')}</div>`;
        wire(box);
        if (entry.tab === 'chat') { renderChat(); scrollChat(); }
    }

    function itemRow(i, e) {
        const who = (e.members || []).find(m => m.id === i.assignee);
        const name = who ? (who.display_name || who.username || 'участник') : null;
        const opts = [`<option value=""${i.assignee ? '' : ' selected'}>никому</option>`]
            .concat((e.members || []).map(m =>
                `<option value="${esc(m.id)}"${m.id === i.assignee ? ' selected' : ''}>${
                    esc(m.display_name || m.username || 'участник')}</option>`)).join('');
        return `<div class="ev-item${i.done ? ' done' : ''}">
            <button class="ev-tick${i.done ? ' on' : ''}" data-tick="${i.id}" aria-label="Отметить">
                ${i.done ? svg(ICON.check, 13) : ''}</button>
            <span class="ev-item-t">${esc(i.title)}</span>
            <select class="ev-who" data-assign="${i.id}" title="${name ? esc(name) : 'не назначено'}">${opts}</select>
            <button class="ev-del" data-del="${i.id}" aria-label="Удалить">${svg(ICON.trash, 12)}</button>
        </div>`;
    }

    function renderChat() {
        const box = document.getElementById('ev-chat');
        if (!box) return;
        if (!messages.length) {
            box.innerHTML = '<div class="pf-none">Пока тихо. Напишите первым — например, во сколько и где собираетесь.</div>';
            return;
        }
        let lastDay = '';
        box.innerHTML = messages.map(m => {
            const d = new Date(m.created_at);
            const day = isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            const sep = day && day !== lastDay ? `<div class="ev-day">${esc(day)}</div>` : '';
            lastDay = day;
            const own = m.user_id === uid();
            const time = isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            return `${sep}<div class="ev-msg${own ? ' own' : ''}">
                ${own ? '' : avatar(m.avatar_url, m.display_name)}
                <div class="ev-bubble">
                    ${own ? '' : `<div class="ev-msg-n">${esc(m.display_name || m.username || 'Участник')}</div>`}
                    <div class="ev-msg-b">${esc(m.body)}</div>
                    <div class="ev-msg-t">${esc(time)}</div>
                </div>
            </div>`;
        }).join('');
    }

    function scrollChat() {
        const box = document.getElementById('ev-chat');
        if (box) box.scrollTop = box.scrollHeight;
    }

    // ── Форма события ───────────────────────────────────────────────────────

    /** Маршруты для привязки: каталог и свои — то, что уже есть на карте. */
    function routeOptions(selected) {
        const all = (typeof routes !== 'undefined') ? Object.values(routes) : [];
        const km = r => {
            const d = (typeof parsedRouteDataCache !== 'undefined') && parsedRouteDataCache[r.id];
            return d && d.distance ? Number(d.distance) : null;
        };
        const opt = r => `<option value="${esc(r.id)}"${r.id === selected ? ' selected' : ''}>${
            esc(r.name)}${km(r) ? ` · ${km(r).toFixed(1)} км` : ''}</option>`;
        const mine = all.filter(r => r.mine && !r.shared);
        const cat  = all.filter(r => !r.mine && !r.shared);
        return `<option value="">без маршрута</option>` +
            (cat.length ? `<optgroup label="Каталог">${cat.map(opt).join('')}</optgroup>` : '') +
            (mine.length ? `<optgroup label="Мои">${mine.map(opt).join('')}</optgroup>` : '');
    }

    /**
     * ⚠️ Поля даты стоят **в столбик**, а не в ряд: «дд.мм.гггг, чч:мм»
     * вместе с кнопкой календаря в половину окна не влезает и обрезается.
     */
    function renderEdit() {
        const box = document.getElementById('events-modal-inner');
        if (!box) return;
        const d = draft || {};
        box.innerHTML = head(d.id ? 'Изменить поход' : 'Собрать поход') + `<div class="ev-body">
            <label class="rs-field"><span>Название</span>
                <input class="review-input" id="ef-title" maxlength="120" value="${esc(d.title || '')}"
                       placeholder="Например: Ластра — Дивчибаре"></label>
            <label class="rs-field mt-4"><span>Сбор — дата и время</span>
                <input class="review-input" type="datetime-local" id="ef-start"
                       value="${esc(toLocalInput(d.starts_at))}"></label>
            <label class="rs-field mt-3"><span>Возвращение — дата и время</span>
                <input class="review-input" type="datetime-local" id="ef-end"
                       value="${esc(toLocalInput(d.ends_at))}"></label>
            <div class="tw-note" id="ef-hint">${d.route_key && estimateHours(d.route_key)
                ? `По маршруту это примерно ${estimateHours(d.route_key).toFixed(1)} ч с привалами`
                : 'Окончание подскажем по маршруту, как выберете его и время сбора'}</div>
            <label class="rs-field mt-4"><span>Маршрут</span>
                <select class="review-input" id="ef-route">${routeOptions(d.route_key)}</select></label>
            <label class="rs-field mt-4"><span>Где сбор</span>
                <input class="review-input" id="ef-meeting" maxlength="200" value="${esc(d.meeting || '')}"
                       placeholder="Например: ЖД станция Ластра"></label>
            <div class="ef-meetrow">
                <button class="pf-btn pf-btn-ghost" id="ef-pick">${svg(ICON.pin, 14)}${
                    d.meet_lat != null ? 'Изменить точку на карте' : 'Указать точку на карте'}</button>
                ${d.meet_lat != null ? `<span class="ef-meetat">${d.meet_lat.toFixed(4)}, ${d.meet_lon.toFixed(4)}
                    <button class="pf-link" id="ef-unpick">убрать</button></span>` : ''}
            </div>
            <label class="rs-field mt-4"><span>Описание</span>
                <textarea class="review-input" id="ef-desc" maxlength="2000" rows="4" style="resize:none;display:block"
                    placeholder="Что взять, какой темп, чего ждать от погоды">${esc(d.description || '')}</textarea></label>
            <label class="rs-field mt-4"><span>Кто может присоединиться</span>
                <select class="review-input" id="ef-vis">
                    <option value="link"${(d.visibility || 'link') === 'link' ? ' selected' : ''}>любой, у кого есть ссылка</option>
                    <option value="friends"${d.visibility === 'friends' ? ' selected' : ''}>только мои друзья</option>
                </select></label>
            <div class="pf-foot">
                <button class="pf-btn pf-btn-ghost" id="ef-cancel">Отмена</button>
                <button class="pf-btn pf-btn-accent" id="ef-save" ${busy ? 'disabled' : ''}>
                    ${d.id ? 'Сохранить' : 'Собрать поход'}</button>
            </div>
        </div>`;
        wire(box);
    }

    /**
     * Форма → черновик. ⚠️ Зовётся **перед любой** перерисовкой и перед
     * сохранением: разметка собирается через `innerHTML`, и набранное иначе
     * пропадает вместе с полями — при неудачной записи форма оказывалась
     * пустой (фидбэк 2026-09-21).
     */
    function readDraft(box) {
        const val = id => { const el = box.querySelector(id); return el ? el.value.trim() : ''; };
        const routeKey = val('#ef-route');
        const r = routeKey && typeof routes !== 'undefined' ? routes[routeKey] : null;
        const geo = r && typeof parsedRouteDataCache !== 'undefined' ? parsedRouteDataCache[r.id] : null;
        const start = val('#ef-start'), end = val('#ef-end');
        draft = Object.assign({}, draft, {
            title: val('#ef-title').slice(0, 120),
            starts_at: start ? new Date(start).toISOString() : null,
            ends_at: end ? new Date(end).toISOString() : null,
            meeting: val('#ef-meeting') || null,
            description: val('#ef-desc') || null,
            visibility: val('#ef-vis') || 'link',
            route_key: routeKey || null,
            route_name: r ? r.name : null,
            route_km: geo && geo.distance ? Number(geo.distance) : null
        });
        return draft;
    }

    /** Поля, которые едут в таблицу (без служебного `id` черновика). */
    function eventFields(d) {
        return {
            title: d.title, starts_at: d.starts_at, ends_at: d.ends_at,
            meeting: d.meeting, description: d.description, visibility: d.visibility,
            route_key: d.route_key, route_name: d.route_name, route_km: d.route_km,
            meet_lat: d.meet_lat != null ? d.meet_lat : null,
            meet_lon: d.meet_lon != null ? d.meet_lon : null
        };
    }

    // ── Действия ────────────────────────────────────────────────────────────

    function newId() {
        return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 3 | 8)).toString(16);
            });
    }

    async function saveEvent(box) {
        const c = client();
        if (!c || !signedIn()) { Account.openModal(); return; }
        const d = readDraft(box);
        if (!d.title) { toast('Придумайте название похода'); return; }
        if (d.ends_at && d.starts_at && new Date(d.ends_at) <= new Date(d.starts_at)) {
            toast('Возвращение должно быть позже сбора'); return;
        }
        busy = true; render();
        try {
            if (d.id) {
                const { error } = await c.from('events')
                    .update(Object.assign({ updated_at: new Date().toISOString() }, eventFields(d)))
                    .eq('id', d.id);
                if (error) throw error;
                const id = d.id;
                busy = false; draft = null;
                stack.pop();
                await openEvent(id, true);
                await loadList(true);
                toast('Поход обновлён');
                return;
            }
            // ⚠️ id придумываем сами и **не** просим строку назад: политика
            // на select проверяет её в той же команде, а участником владелец
            // становится триггером — уже после. `insert ... returning` из-за
            // этого возвращал пустоту, и создание похода выглядело ошибкой,
            // хотя запись проходила (фидбэк 2026-09-21).
            const id = newId();
            const { error } = await c.from('events')
                .insert(Object.assign({ id, owner: uid() }, eventFields(d)));
            if (error) throw error;
            busy = false; draft = null;
            stack.pop();
            await loadList(true);
            await openEvent(id);
            toast('Поход собран — поделитесь ссылкой');
        } catch (e) {
            console.warn('[events] сохранение:', e);
            toast('Не удалось сохранить: ' + (e && e.message ? e.message : 'ошибка базы'));
        } finally {
            busy = false;
            render();
        }
    }

    // ── Точка сбора на карте ────────────────────────────────────────────────

    /**
     * Название точки — ближайшая подпись на карте: сначала станция (до
     * 700 м), потом населённый пункт. Станция важнее: на неё и приезжают,
     * а деревня рядом может называться иначе.
     */
    function nearestLabel(at) {
        const m = window.map;
        let best = null;
        if (m && m.getSource('railways-src')) {
            let feats = [];
            try { feats = m.querySourceFeatures('railways-src'); } catch (e) {}
            for (const f of feats) {
                const p = f.properties || {};
                if (p.kind !== 'station' || !f.geometry || f.geometry.type !== 'Point') continue;
                const name = p.name_ru || p.name;
                if (!name) continue;
                const d = metersBetween(at, f.geometry.coordinates);
                if (d <= 700 && (!best || d < best.meters)) best = { name, meters: d, station: true };
            }
        }
        if (best) return best;
        const s = (window.PointInsight && PointInsight.nearestSettlement)
            ? PointInsight.nearestSettlement(at) : null;
        return (s && s.meters <= 6000) ? s : null;
    }

    function metersBetween(a, b) {
        const R = 6371000, rad = Math.PI / 180;
        const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
        const h = Math.sin(dLat / 2) ** 2 +
                  Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    let pickHandler = null;
    const PICK_SRC = 'event-pick-src';

    /**
     * Метка выбираемой точки сбора.
     *
     * ⚠️ Без неё режим был слепым: плашка внизу писала «Точка сбора:
     * Јагодићи», а на карте не было ничего, и куда именно ты нажал — видно
     * не было (фидбэк 2026-09-21). Слой транзиентный: заводится на время
     * выбора и снимается на выходе.
     */
    function paintMeetDot(coords) {
        const m = window.map;
        if (!m) return;
        if (!m.getSource(PICK_SRC)) {
            m.addSource(PICK_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            m.addLayer({
                id: 'event-pick-halo', type: 'circle', source: PICK_SRC,
                paint: { 'circle-radius': 18, 'circle-color': '#7A5EA6',
                         'circle-opacity': 0.25, 'circle-blur': 0.55 }
            });
            m.addLayer({
                id: 'event-pick-dot', type: 'circle', source: PICK_SRC,
                paint: { 'circle-radius': 8, 'circle-color': '#7A5EA6',
                         'circle-stroke-width': 3, 'circle-stroke-color': '#fff' }
            });
            m.addLayer({
                id: 'event-pick-label', type: 'symbol', source: PICK_SRC,
                layout: { 'text-field': ['get', 'label'], 'text-size': 11.5,
                          'text-offset': [0, 1.5], 'text-anchor': 'top',
                          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                          'text-allow-overlap': true, 'text-letter-spacing': 0.04 },
                paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(10,8,14,.9)',
                         'text-halo-width': 1.6 }
            });
        }
        m.getSource(PICK_SRC).setData({
            type: 'FeatureCollection',
            features: coords ? [{ type: 'Feature',
                geometry: { type: 'Point', coordinates: coords },
                properties: { label: 'Сбор' } }] : []
        });
    }

    function clearMeetDot() {
        const m = window.map;
        if (!m || !m.getStyle) return;
        ['event-pick-label', 'event-pick-dot', 'event-pick-halo'].forEach(id => {
            if (m.getLayer(id)) m.removeLayer(id);
        });
        if (m.getSource(PICK_SRC)) m.removeSource(PICK_SRC);
    }

    /**
     * Указать точку сбора пальцем. Окно на это время **прячется**: карта под
     * ним, и сквозь оверлей по ней не щёлкнуть. Черновик формы при этом
     * остаётся в `draft`, поэтому после выбора возвращаемся в ту же форму со
     * всем набранным.
     */
    function pickMeeting(box) {
        readDraft(box);
        const el = host();
        if (el) el.classList.remove('open');
        document.body.classList.add('tw-photo-place');

        let bar = document.getElementById('event-pick-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'event-pick-bar';
            document.body.appendChild(bar);
        }
        const paint = at => {
            const label = at ? nearestLabel(at) : null;
            bar.innerHTML = `
                <div class="pp-head">
                    <div class="pp-title">${at
                        ? `Точка сбора: ${esc((label && label.name) || 'без названия')}`
                        : 'Нажмите на карте место сбора'}</div>
                    <button class="pp-x" id="epk-x" aria-label="Отмена">✕</button>
                </div>
                <div class="pp-actions">
                    <button class="pf-btn pf-btn-accent" id="epk-ok" ${at ? '' : 'disabled'}>Это здесь</button>
                    <span class="pp-hint">${at
                        ? (label ? `ближайшее название — ${esc(label.name)}${
                            label.meters ? `, ${Math.round(label.meters)} м` : ''}` : 'названия рядом нет')
                        : 'название подставим по ближайшей подписи на карте'}</span>
                </div>`;
            bar.classList.add('open');
            bar.querySelector('#epk-x').onclick = () => finish(false);
            bar.querySelector('#epk-ok').onclick = () => finish(true, at, label);
        };

        // Уже выбранную точку показываем сразу: «изменить» начинается с неё
        let at = (draft.meet_lat != null && draft.meet_lon != null)
            ? [draft.meet_lon, draft.meet_lat] : null;
        paintMeetDot(at);
        paint(at);
        // ⚠️ С нулевым отступом: от открытой карточки маршрута у карты
        // остаётся `padding`, и точка уезжает из кадра (та же грабля, что у
        // `fitBounds` в script.js)
        if (at) {
            map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 12), essential: true,
                        padding: { top: 0, right: 0, bottom: 0, left: 0 } });
        }

        pickHandler = e => {
            at = [e.lngLat.lng, e.lngLat.lat];
            paintMeetDot(at);
            paint(at);
        };
        map.on('click', pickHandler);

        function finish(ok, point, label) {
            if (pickHandler) { map.off('click', pickHandler); pickHandler = null; }
            bar.classList.remove('open');
            document.body.classList.remove('tw-photo-place');
            clearMeetDot();
            if (ok && point) {
                draft.meet_lon = point[0];
                draft.meet_lat = point[1];
                // Название не затираем, если человек написал своё
                if (!draft.meeting && label && label.name) draft.meeting = label.name;
            }
            show();
            render();
        }
    }

    async function act(fn, okText) {
        const c = client();
        if (!c) return;
        busy = true;
        try {
            const r = await fn(c);
            if (r && r.error) throw r.error;
            if (okText) toast(okText);
            const t = top();
            if (t && t.kind === 'event') { t.data = await fetchEvent(t.id); }
            await loadList(true);
        } catch (e) {
            console.warn('[events]', e);
            toast('Не получилось. Попробуйте ещё раз');
        } finally {
            busy = false;
            render();
        }
    }

    async function sendMessage(text) {
        const t = top();
        const c = client();
        if (!c || !t || t.kind !== 'event' || !text.trim()) return;
        try {
            const { error } = await c.from('event_messages')
                .insert({ event_id: t.id, user_id: uid(), body: text.trim().slice(0, 1000) });
            if (error) throw error;
            await pullFeed(t.id);
            renderChat();
            scrollChat();
        } catch (e) {
            console.warn('[events] сообщение:', e);
            toast('Сообщение не отправилось');
        }
    }

    // ── Обработчики ─────────────────────────────────────────────────────────

    function wire(box) {
        const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
        const t = top();
        on('#ev-close', close);
        on('#ev-back', back);
        on('#ev-new', () => { draft = {}; push({ kind: 'edit' }); });
        on('#ef-cancel', () => { draft = null; back(); });
        on('#ef-save', () => saveEvent(box));
        on('#ef-pick', () => pickMeeting(box));
        on('#ef-unpick', () => {
            readDraft(box);
            draft.meet_lat = null; draft.meet_lon = null;
            render();
        });
        on('#ev-meet-show', () => {
            if (window.PointInsight && t.data.meet_lat != null) {
                close();
                PointInsight.show(t.data.meet_lat, t.data.meet_lon, 'Сбор: ' + (t.data.meeting || 'точка'), true);
            }
        });

        // Окончание подсказываем по маршруту: считать самому незачем
        const startEl = box.querySelector('#ef-start');
        const endEl = box.querySelector('#ef-end');
        const routeEl = box.querySelector('#ef-route');
        const hint = box.querySelector('#ef-hint');
        const suggest = () => {
            if (!startEl || !endEl || !startEl.value) return;
            const h = estimateHours(routeEl && routeEl.value);
            if (hint) {
                hint.textContent = h
                    ? `По маршруту это примерно ${h.toFixed(1)} ч с привалами`
                    : 'Окончание подскажем по маршруту, как выберете его и время сбора';
            }
            if (!h || endEl.value) return;
            const end = new Date(new Date(startEl.value).getTime() + Math.round(h * 4) / 4 * 3600000);
            endEl.value = toLocalInput(end.toISOString());
        };
        if (startEl) startEl.onchange = suggest;
        if (routeEl) routeEl.onchange = suggest;

        box.querySelectorAll('[data-ev]').forEach(b => {
            b.onclick = () => openEvent(b.dataset.ev);
        });
        box.querySelectorAll('[data-tab]').forEach(b => {
            b.onclick = () => {
                t.tab = b.dataset.tab;
                render();
                if (t.tab === 'chat' && !messages.length) pullFeed(t.id, true);
            };
        });

        on('#ev-join', () => act(async c => {
            const { data, error } = await c.rpc('join_event', { ev: t.id });
            if (error) return { error };
            if (data !== 'ok') return { error: new Error(data) };
            await pullFeed(t.id, true);
            startPoll(t.id);
        }, 'Вы в походе'));

        on('#ev-leave', () => act(c =>
            c.from('event_members').delete().eq('event_id', t.id).eq('user_id', uid()), 'Вы вышли из похода'));

        on('#ev-edit', () => {
            draft = Object.assign({}, t.data, { id: t.id });
            push({ kind: 'edit' });
        });
        on('#ev-back', back);

        // Отмена похода — в два нажатия, без системного confirm()
        const del = box.querySelector('#ev-delete');
        if (del) {
            let armed = null;
            del.onclick = () => {
                if (armed) {
                    clearTimeout(armed);
                    act(c => c.from('events').delete().eq('id', t.id), 'Поход отменён')
                        .then(() => { stopPoll(); stack = [{ kind: 'list' }]; loadList(true); render(); });
                    return;
                }
                del.textContent = 'Точно отменить? Нажмите ещё раз';
                armed = setTimeout(() => { armed = null; del.textContent = 'Отменить поход'; }, 3500);
            };
        }

        on('#ev-route', () => {
            const key = t.data.route_key;
            if (key && typeof routes !== 'undefined' && routes[key]) { close(); triggerRouteSelection(key); }
            else toast('Этот маршрут сейчас не на карте');
        });
        on('#ev-copy', async () => {
            try {
                await navigator.clipboard.writeText(eventLink(t.id));
                toast('Ссылка скопирована');
            } catch (e) {
                const i = box.querySelector('#ev-link');
                if (i) { i.select(); document.execCommand('copy'); toast('Ссылка скопирована'); }
            }
        });

        box.querySelectorAll('[data-role]').forEach(b => {
            b.onclick = () => act(c => c.from('event_members')
                .update({ role: b.dataset.to }).eq('event_id', t.id).eq('user_id', b.dataset.role));
        });
        box.querySelectorAll('[data-kick]').forEach(b => {
            b.onclick = () => act(c => c.from('event_members')
                .delete().eq('event_id', t.id).eq('user_id', b.dataset.kick));
        });

        // ── Сборы
        box.querySelectorAll('[data-tick]').forEach(b => {
            b.onclick = () => {
                const item = (t.data.items || []).find(i => String(i.id) === b.dataset.tick);
                if (!item) return;
                const next = !item.done;
                item.done = next;                     // сразу, не дожидаясь базы
                b.classList.toggle('on', next);
                b.closest('.ev-item').classList.toggle('done', next);
                act(c => c.from('event_items')
                    .update({ done: next, done_at: next ? new Date().toISOString() : null })
                    .eq('id', item.id));
            };
        });
        box.querySelectorAll('[data-assign]').forEach(sel => {
            sel.onchange = () => act(c => c.from('event_items')
                .update({ assignee: sel.value || null }).eq('id', sel.dataset.assign));
        });
        box.querySelectorAll('[data-del]').forEach(b => {
            b.onclick = () => act(c => c.from('event_items').delete().eq('id', b.dataset.del));
        });

        const addForm = box.querySelector('#ev-add');
        if (addForm) addForm.onsubmit = e => {
            e.preventDefault();
            const input = box.querySelector('#ev-item');
            const title = input.value.trim().slice(0, 120);
            if (!title) return;
            input.value = '';
            act(c => c.from('event_items').insert({ event_id: t.id, title }));
        };

        const sendForm = box.querySelector('#ev-send');
        if (sendForm) sendForm.onsubmit = e => {
            e.preventDefault();
            const input = box.querySelector('#ev-msg');
            const text = input.value;
            input.value = '';
            sendMessage(text);
        };
    }

    // ── Запуск ──────────────────────────────────────────────────────────────

    function openFromHash() {
        if (!location.hash.startsWith(HASH)) return false;
        const id = location.hash.slice(HASH.length);
        if (!id) return false;
        stack = [{ kind: 'list' }];
        openEvent(id);
        return true;
    }

    function onAccount() {
        if (!signedIn()) {
            list = []; loadedFor = null;
            stopPoll();
            if (top()) close();
            return;
        }
        loadList();
        // Пришли по ссылке и вошли уже потом — открываем то, за чем шли
        openFromHash();
    }

    function init() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && top()) close();
        });
        window.addEventListener('hashchange', openFromHash);
        openFromHash();
        // Вкладку свернули и вернули — догоняем чат сразу, не ждя опроса
        document.addEventListener('visibilitychange', () => {
            const t = top();
            if (document.visibilityState === 'visible' && t && t.kind === 'event' && t.data && t.data.my_role) {
                pullFeed(t.id);
            }
        });
    }

    window.Events = {
        open, close, openEvent, onAccount, openFromHash,
        /** Сколько походов у меня — для подписи кнопки в профиле */
        count() { return list.length; }
    };

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
