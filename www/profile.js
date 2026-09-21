/**
 * Профили, приватность и друзья.
 *
 * Профиль открывается по нику: `#u/grisha` — ссылкой или QR-кодом.
 *
 * ⚠️ **Что видно, решает база.** Чужой профиль приезжает одним вызовом
 * `get_public_profile(handle)` — функции с правами владельца, которая сама
 * применяет настройки приватности: закрытый блок в ответе просто
 * отсутствует. Здесь нет ни одной проверки «показывать ли»: рисуем то, что
 * пришло. Иначе «приватный профиль» означал бы «страница не рисует блок», а
 * данные всё равно лежали бы у клиента и были бы видны в отладчике.
 *
 * Дружба — формальность: она лишь переводит видимость `friends` из «нет» в
 * «да». Сама по себе прав не даёт.
 *
 * Геометрию чужих маршрутов база не отдаёт вовсе. Поэтому в списке
 * открывается только то, что можно открыть честно: маршрут каталога (по
 * `route_key`) или чужой маршрут, который владелец сам открыл по ссылке
 * (`shared_id` → `#shared_<id>`, уже умеет account.js).
 *
 * Зависит от account.js (`Account.client`, `Account.userId`, `Account.status`,
 * `MyRoutes.toast`) и script.js (`triggerRouteSelection`, `routes`).
 */
(function () {
    'use strict';

    const QR_SDK = 'libs/qrcode.js';     // ~55 КБ — грузим по первому показу
    const HASH = '#u/';
    const LEVELS = [
        { value: 'public',  label: 'Все' },
        { value: 'friends', label: 'Друзья' },
        { value: 'private', label: 'Никто' }
    ];
    const FIELDS = [
        { key: 'visibility',   label: 'Профиль',      hint: 'Закрытый профиль не откроется даже по ссылке' },
        { key: 'show_done',    label: 'Пройденные',   hint: '' },
        { key: 'show_planned', label: 'Планируемые',  hint: '' },
        { key: 'show_stats',   label: 'Достижения',   hint: '' },
        { key: 'show_friends', label: 'Друзья',       hint: '' }
    ];

    /** Достижения считаются из пройденного — своей таблицы у них нет. */
    const BADGES = [
        { id: 'first',  label: 'Первый маршрут', test: s => s.done_count >= 1 },
        { id: 'km100',  label: '100 км',         test: s => s.done_km >= 100 },
        { id: 'km250',  label: '250 км',         test: s => s.done_km >= 250 },
        { id: 'km500',  label: '500 км',         test: s => s.done_km >= 500 },
        { id: 'km1000', label: '1000 км',        test: s => s.done_km >= 1000 },
        { id: 'r10',    label: '10 маршрутов',   test: s => s.done_count >= 10 },
        { id: 'r25',    label: '25 маршрутов',   test: s => s.done_count >= 25 },
        { id: 'r50',    label: '50 маршрутов',   test: s => s.done_count >= 50 },
        { id: 'long20', label: 'Переход 20 км',  test: s => s.longest_km >= 20 }
    ];

    let me = null;          // своя строка profiles
    let requests = [];
    let friends = [];
    let busy = false;
    let nickState = null;   // { value, state: 'checking'|'free'|'taken'|'bad' }
    let qrLoading = null;
    let loadedFor = null;   // id пользователя, для которого всё загружено

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
        link:   'M13.8 10.2a4 4 0 010 5.7l-2.1 2.1a4 4 0 01-5.7-5.7l1-1m5.2-1.4l1-1a4 4 0 115.7 5.7l-2.1 2.1',
        qr:     'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2m4 0h-2m0 4h2m-6 2h2',
        user:   'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0A17.9 17.9 0 0112 21.75c-2.68 0-5.22-.58-7.5-1.65z',
        users:  'M17 20h5v-1a4 4 0 00-3-3.87M9 20H2v-1a5 5 0 016.3-4.83M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
        check:  'M5 13l4 4L19 7',
        close:  'M6 18L18 6M6 6l12 12',
        back:   'M15 19l-7-7 7-7',
        plus:   'M12 5v14M5 12h14',
        gear:   'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7.4 7.4 0 00-2-1.2L14.5 2h-4l-.4 2.5c-.8.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5A7.4 7.4 0 005.6 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
        cal:    'M8 3v3m8-3v3M4 9h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z',
        lock:   'M7 11V8a5 5 0 0110 0v3M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1z'
    };

    function profileLink(nick) {
        return location.origin + location.pathname + HASH + nick;
    }

    function fmtDate(v) {
        if (!v) return '';
        const d = new Date(String(v).length <= 10 ? v + 'T12:00:00' : v);
        return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function plural(n, one, few, many) {
        return n % 10 === 1 && n % 100 !== 11 ? one
            : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
    }

    // ── Своя строка профиля, друзья, заявки ─────────────────────────────────

    async function load(force) {
        const c = client();
        if (!c || !signedIn()) { me = null; requests = []; friends = []; loadedFor = null; return; }
        if (loadedFor === uid() && !force) return;
        loadedFor = uid();
        try {
            const [prof, reqs, frs] = await Promise.all([
                c.from('profiles').select('*').eq('id', uid()).maybeSingle(),
                c.rpc('my_friend_requests'),
                c.rpc('my_friends')
            ]);
            me = prof.data || null;
            requests = reqs.data || [];
            friends = frs.data || [];
            await backfillMeta();
        } catch (e) {
            console.warn('[profile] не загрузился:', e);
        }
        render();
        if (window.Account && Account.refreshButtons) Account.refreshButtons();
    }

    /**
     * Имя и аватар из Google в строку профиля.
     *
     * ⚠️ Чужой профиль собирает база, и берёт она их из `profiles`, а не из
     * `auth.users`. У тех, кто завёл аккаунт до этой таблицы полей, там
     * пусто — и в публичном профиле висели бы буква вместо фото и «Без
     * имени». Дозаполняем молча, один раз.
     */
    async function backfillMeta() {
        if (!me) return;
        const c = client();
        const m = (window.Account && Account.meta && Account.meta()) || {};
        const patch = {};
        if (!me.display_name && m.name) patch.display_name = m.name;
        if (!me.avatar_url && m.avatar) patch.avatar_url = m.avatar;

        // ⚠️ Ник выдаём сразу, не дожидаясь, пока человек зайдёт в
        // настройки: без ника профилем нельзя поделиться и его нельзя
        // открыть из списка друзей — только что зарегистрировавшийся
        // оказывался невидимым для собственных друзей (фидбэк 2026-09-21).
        // Занятые варианты обходим приписыванием цифр.
        if (!me.username) {
            const base = suggestNick();
            for (let i = 0; i < 6; i++) {
                const tryNick = (i ? base.slice(0, 17) + i : base).slice(0, 20);
                try {
                    const { data } = await c.rpc('username_available', { handle: tryNick });
                    if (data === false) continue;
                } catch (e) { break; }
                patch.username = tryNick;
                break;
            }
        }
        if (!Object.keys(patch).length) return;
        try {
            const { data } = await c.from('profiles').update(patch).eq('id', uid()).select().single();
            if (data) me = data;
        } catch (e) {
            // Ник могли занять между проверкой и записью — не беда, человек
            // выберет свой в настройках
            console.warn('[profile] дозаполнение:', e);
        }
    }

    /** Ник нужен, чтобы профилем можно было поделиться. Предложим из имени. */
    function suggestNick() {
        const src = (me && me.display_name) || (window.Account && Account.email() || '').split('@')[0] || '';
        const translit = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',
            н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',
            э:'e',ю:'yu',я:'ya' };
        return src.toLowerCase().split('').map(ch => translit[ch] !== undefined ? translit[ch] : ch)
            .join('').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'hiker';
    }

    /**
     * ⚠️ `rerender: false` — когда интерфейс уже показал новое состояние сам
     * (переключатель видимости переезжает по нажатию). Перерисовка в этот
     * момент вернула бы пилюлю на старое место: `me` обновится только после
     * ответа базы. Та же причина, что у `setBusy` в route_status.js.
     */
    async function saveProfile(patch, rerender) {
        const c = client();
        if (!c || !me) return false;
        if (rerender !== false) { busy = true; render(); }
        try {
            const { data, error } = await c.from('profiles')
                .update(Object.assign({ updated_at: new Date().toISOString() }, patch))
                .eq('id', uid()).select().single();
            if (error) throw error;
            me = data || Object.assign(me, patch);
            return true;
        } catch (e) {
            console.warn('[profile] сохранение:', e);
            // Уникальный индекс на ник — единственная ошибка, про которую
            // человеку есть что сделать
            toast(String(e.message || '').includes('profiles_username_key')
                ? 'Такой ник уже занят' : 'Не удалось сохранить профиль');
            return false;
        } finally {
            busy = false;
            if (rerender !== false) render();
        }
    }

    /** Подпись под полем ника. Отдельной функцией — см. `checkNick`. */
    function nickNoteHTML() {
        const ns = nickState;
        if (!(me && me.username) && !ns) return '<em class="pf-warn">Придумайте ник — без него профилем не поделиться</em>';
        if (!ns) return '';
        if (ns.state === 'bad')      return '<em class="pf-warn">3–20 символов: латиница, цифры, подчёркивание</em>';
        if (ns.state === 'checking') return '<em>Проверяю…</em>';
        if (ns.state === 'taken')    return '<em class="pf-warn">Занят</em>';
        if (ns.state === 'free')     return '<em class="pf-ok">Свободен</em>';
        return '';
    }

    function paintNickNote() {
        const el = document.getElementById('pf-nicknote');
        if (el) el.innerHTML = nickNoteHTML();
    }

    let nickTimer = null;
    /**
     * ⚠️ Перерисовывать здесь можно **только подпись** под полем.
     * `renderSettings()` собирает блок заново через `innerHTML`, то есть
     * подменяет само поле ввода: набранный символ пропадал вместе с фокусом,
     * и ник было не набрать вовсе (фидбэк 2026-09-21).
     */
    function checkNick(value) {
        const v = String(value || '').trim().toLowerCase();
        clearTimeout(nickTimer);
        if (!/^[a-z0-9_]{3,20}$/.test(v)) {
            nickState = { value: v, state: v ? 'bad' : null };
            paintNickNote();
            return;
        }
        if (me && v === me.username) { nickState = null; paintNickNote(); return; }
        nickState = { value: v, state: 'checking' };
        paintNickNote();
        nickTimer = setTimeout(async () => {
            const c = client();
            if (!c) return;
            try {
                const { data } = await c.rpc('username_available', { handle: v });
                nickState = { value: v, state: data === false ? 'taken' : 'free' };
            } catch (e) { nickState = { value: v, state: null }; }
            paintNickNote();
        }, 420);
    }

    // ── Дружба ──────────────────────────────────────────────────────────────

    async function friendAction(action) {
        const c = client();
        if (!c || !signedIn()) { Account.openModal(); return; }
        const entry = top();
        const viewed = entry && entry.data;
        if (!viewed || !viewed.id) return;
        busy = true; render();
        try {
            if (action === 'add') {
                const { error } = await c.from('friendships')
                    .insert({ requester: uid(), addressee: viewed.id });
                if (error) throw error;
                viewed.friend = 'pending_out';
                toast('Заявка отправлена');
            } else if (action === 'accept') {
                const { error } = await c.from('friendships').update({ status: 'accepted' })
                    .eq('requester', viewed.id).eq('addressee', uid());
                if (error) throw error;
                // Могли постучаться навстречу одновременно — вторая строка
                // осталась бы висеть заявкой уже после дружбы
                await c.from('friendships').delete().eq('requester', uid()).eq('addressee', viewed.id);
                viewed.friend = 'friends';
                toast('Теперь вы друзья');
            } else if (action === 'cancel' || action === 'remove') {
                // Строка одна на пару, направление неизвестно — сносим обе
                // возможные: RLS всё равно пустит только к своим
                await c.from('friendships').delete().eq('requester', uid()).eq('addressee', viewed.id);
                await c.from('friendships').delete().eq('requester', viewed.id).eq('addressee', uid());
                viewed.friend = 'none';
            }
            await load(true);
            // Дружба меняет видимость — профиль надо перечитать целиком:
            // после подтверждения могли открыться блоки «только друзьям»
            if (entry.nick) {
                const fresh = await fetchProfile(entry.nick);
                if (fresh) entry.data = fresh;
            }
        } catch (e) {
            console.warn('[profile] дружба:', e);
            toast('Не удалось изменить дружбу');
        } finally {
            busy = false; render();
        }
    }

    async function respondRequest(fromId, accept) {
        const c = client();
        if (!c) return;
        busy = true; render();
        try {
            if (accept) {
                await c.from('friendships').update({ status: 'accepted' })
                    .eq('requester', fromId).eq('addressee', uid());
            } else {
                await c.from('friendships').delete().eq('requester', fromId).eq('addressee', uid());
            }
            await load(true);
        } catch (e) {
            console.warn('[profile] заявка:', e);
            toast('Не удалось ответить на заявку');
        } finally {
            busy = false; render();
        }
    }

    // ── Экраны и переходы ───────────────────────────────────────────────────

    /**
     * Стек экранов. Профиль → друзья → чужой профиль → его друзья — всё это
     * переходы, и из каждого нужно уметь вернуться туда, откуда пришёл.
     *
     * ⚠️ Раньше экран был один (`view`), и «назад» существовало только из
     * друзей в настройки. Провалившись из чужого профиля в его друзей, выйти
     * можно было лишь закрыв весь профиль и открыв заново (фидбэк 2026-09-21).
     *
     * Запись: `{ kind: 'public'|'settings'|'friends', nick?, data? }`.
     * `data` — уже полученный ответ базы, чтобы «назад» не перезапрашивал.
     */
    let stack = [];
    const top = () => stack[stack.length - 1] || null;

    /**
     * Откуда пришли на самый первый экран. Профиль, настройки и друзья
     * открываются из окна аккаунта, и «назад» в корне должно возвращать
     * туда: иначе из друзей и настроек выйти можно было только крестиком —
     * то есть закрыв всё и начав заново (фидбэк 2026-09-21).
     */
    let fromAccount = false;

    function push(entry) {
        stack.push(entry);
        show();
        render();
    }

    function back() {
        if (stack.length > 1) { stack.pop(); render(); return; }
        if (fromAccount) { close(); if (window.Account) Account.openModal(); return; }
        close();
    }

    /** Есть ли куда вернуться — по этому рисуется стрелочка в шапке. */
    const canBack = () => stack.length > 1 || fromAccount;

    function host() { return document.getElementById('profile-modal'); }

    function ensureModal() {
        let el = host();
        if (el) return el;
        el = document.createElement('div');
        el.id = 'profile-modal';
        el.className = 'tw-modal';
        el.innerHTML = '<div class="tw-modal-inner pf-inner" id="profile-modal-inner"></div>';
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

    function close() {
        const el = host();
        if (el) el.classList.remove('open');
        stack = [];
        fromAccount = false;
        // Ссылка на профиль в адресной строке больше не нужна: иначе
        // перезагрузка снова открыла бы чужой профиль
        if (location.hash.startsWith(HASH)) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }

    function open(which) {
        fromAccount = true;
        if (which === 'public') {
            // Ника ещё нет — открывать нечего, сразу в настройки
            if (!me || !me.username) { stack = [{ kind: 'settings' }]; show(); render(); return; }
            stack = [];
            openUser(me.username);
            return;
        }
        stack = [{ kind: which || 'settings' }];
        show();
        render();
    }

    async function openUser(nick) {
        nick = String(nick || '').trim().toLowerCase();
        if (!nick) return;
        const entry = { kind: 'public', nick, data: null };
        push(entry);

        const c = client();
        if (!c) {
            // SDK ещё едет — попробуем, когда приедет. С потолком: в
            // Capacitor-обёртке клиента не будет вовсе, и цикл не кончился бы
            if ((openUser._tries = (openUser._tries || 0) + 1) > 12) {
                entry.data = { state: 'error' };
                render();
                return;
            }
            setTimeout(() => {
                if (top() === entry && !entry.data) { stack.pop(); openUser(nick); }
            }, 600);
            return;
        }
        openUser._tries = 0;
        entry.data = await fetchProfile(nick);
        if (top() === entry) render();
    }

    async function fetchProfile(nick) {
        const c = client();
        if (!c) return { state: 'error' };
        try {
            const { data, error } = await c.rpc('get_public_profile', { handle: nick });
            if (error) throw error;
            return data || { state: 'not_found' };
        } catch (e) {
            console.warn('[profile] чужой профиль:', e);
            return { state: 'error' };
        }
    }

    // ── Общие куски разметки ────────────────────────────────────────────────

    /** Оттенок обложки — из ника: у каждого профиля свой, без загрузок. */
    function hueOf(seed) {
        let h = 0;
        for (const ch of String(seed || 'tw')) h = (h * 31 + ch.charCodeAt(0)) % 360;
        return h;
    }

    function avatar(url, name, big) {
        const letter = esc(((name || '?').trim()[0] || '?'));
        const cls = 'pf-ava' + (big ? ' lg' : '');
        return url
            ? `<img class="${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
            : `<span class="${cls}">${letter}</span>`;
    }

    /**
     * Шапка экрана: обложка, аватар, имя и ряд кнопок. «Назад» появляется,
     * как только в стеке есть куда возвращаться, — на каждом экране.
     */
    function hero(opts) {
        const nav = `<div class="pf-nav">
            ${canBack() ? `<button class="pf-x" id="pf-back" aria-label="Назад">${svg(ICON.back, 16)}</button>` : '<span></span>'}
            ${opts.title ? `<div class="pf-nav-t">${esc(opts.title)}</div>` : '<span></span>'}
            <button class="pf-x" id="pf-close" aria-label="Закрыть">${svg(ICON.close, 16)}</button>
        </div>`;
        if (!opts.person) return `<div class="pf-hero pf-hero-flat">${nav}</div>`;
        return `<div class="pf-hero" style="--hue:${hueOf(opts.nick || opts.name)}">
            ${nav}
            <div class="pf-hero-main">
                ${avatar(opts.avatar, opts.name, true)}
                <div class="pf-hero-t">
                    <div class="pf-name">${esc(opts.name || 'Без имени')}</div>
                    ${opts.nick ? `<div class="pf-nick">@${esc(opts.nick)}</div>` : ''}
                </div>
            </div>
        </div>`;
    }

    function section(title, count, body) {
        return `<div class="pf-sec"><div class="pf-sec-h">${esc(title)}${
            count != null ? ` <em>${count}</em>` : ''}</div>${body}</div>`;
    }

    /**
     * «Поделиться профилем» — ссылка, копирование и QR. Нужен на всех своих
     * экранах: показать профиль другу хочется из любого места, а не только
     * из настроек (фидбэк 2026-09-21).
     */
    function shareBlock() {
        if (!me) return '';
        if (!me.username) {
            return section('Ссылка на профиль', null,
                `<p class="pf-note" style="margin-top:0">Ссылка появится, когда вы выберете ник.</p>
                 <button class="pf-btn pf-btn-ghost mt-2" id="pf-to-settings">${svg(ICON.gear, 14)}Выбрать ник</button>`);
        }
        return section('Поделиться профилем', null, `
            <div class="pf-linkbox">
                <input class="review-input" id="pf-link" readonly value="${esc(profileLink(me.username))}">
                <button class="pf-btn pf-btn-ghost" id="pf-copy" title="Скопировать ссылку">${svg(ICON.link, 14)}Копировать</button>
                <button class="pf-btn pf-btn-ghost" id="pf-qr" title="QR-код профиля">${svg(ICON.qr, 14)}QR</button>
            </div>
            <div id="pf-qr-box" class="pf-qr hidden"></div>`);
    }

    function render() {
        const el = host();
        if (!el || !el.classList.contains('open')) return;
        const t = top();
        if (!t) { close(); return; }
        if (t.kind === 'settings') return renderSettings();
        if (t.kind === 'friends')  return renderFriends();
        return renderPublic(t);
    }

    // ── Профиль (свой и чужой) ──────────────────────────────────────────────

    function statsBlock(s, isSelf) {
        if (!s || !s.done_count) {
            return section('Достижения', null, `<div class="pf-none">${isSelf
                ? 'Пройденных маршрутов пока нет. Откройте маршрут и отметьте его пройденным — километры и значки появятся здесь.'
                : 'Пройденных маршрутов пока нет.'}</div>`);
        }
        const tiles = [
            { v: Number(s.done_km || 0).toFixed(1), l: 'км пройдено' },
            { v: s.done_count, l: plural(s.done_count, 'маршрут', 'маршрута', 'маршрутов') },
            { v: Number(s.longest_km || 0).toFixed(1), l: 'км самый длинный' }
        ];
        const earned = BADGES.filter(b => b.test(s));
        const next = BADGES.find(b => !b.test(s));
        return `<div class="pf-tiles">${tiles.map(t =>
                `<div class="pf-tile"><b>${esc(t.v)}</b><span>${esc(t.l)}</span></div>`).join('')}</div>
            <div class="pf-badges">
                ${earned.map(b => `<span class="pf-badge">${svg(ICON.check, 11)}${esc(b.label)}</span>`).join('')}
                ${next ? `<span class="pf-badge pf-badge-next">Следующее: ${esc(next.label)}</span>` : ''}
            </div>`;
    }

    function routeRow(r) {
        const openable = r.route_key || r.shared_id;
        const meta = [r.km != null ? Number(r.km).toFixed(1) + ' км' : '', fmtDate(r.date)]
            .filter(Boolean).join(' · ');
        return `<button class="pf-row${openable ? '' : ' pf-row-flat'}"
                    ${openable ? `data-key="${esc(r.route_key || '')}" data-shared="${esc(r.shared_id || '')}"` : 'disabled'}>
                    <span class="pf-row-name">${esc(r.name || 'Маршрут')}</span>
                    <span class="pf-row-meta">${esc(meta)}</span>
                </button>`;
    }

    function friendButton(p) {
        if (p.friend === 'self') {
            return `<button class="pf-btn pf-btn-ghost" id="pf-to-settings">${svg(ICON.gear, 14)}Настройки</button>
                    <button class="pf-btn pf-btn-ghost" id="pf-to-friends">${svg(ICON.users, 14)}Друзья${
                        requests.length ? ` <b class="tw-pill">${requests.length}</b>` : ''}</button>`;
        }
        if (!signedIn()) {
            return `<button class="pf-btn pf-btn-ghost" id="pf-signin">${svg(ICON.user, 14)}Войти, чтобы добавить в друзья</button>`;
        }
        if (p.friend === 'friends') {
            return `<span class="pf-friend-on">${svg(ICON.check, 13)}В друзьях</span>
                    <button class="pf-link" data-friend="remove">удалить из друзей</button>`;
        }
        if (p.friend === 'pending_out') {
            return `<span class="pf-friend-wait">Заявка отправлена</span>
                    <button class="pf-link" data-friend="cancel">отменить</button>`;
        }
        if (p.friend === 'pending_in') {
            return `<button class="pf-btn pf-btn-accent" data-friend="accept">${svg(ICON.check, 14)}Принять заявку</button>
                    <button class="pf-link" data-friend="cancel">отклонить</button>`;
        }
        return `<button class="pf-btn pf-btn-accent" data-friend="add">${svg(ICON.plus, 14)}Добавить в друзья</button>`;
    }

    function renderPublic(entry) {
        const box = document.getElementById('profile-modal-inner');
        if (!box) return;
        const p = entry.data;
        const nick = entry.nick;

        if (!p) {
            box.innerHTML = hero({ title: '@' + nick }) +
                `<div class="pf-body"><div class="pf-empty">Открываю профиль…</div></div>`;
            return wire(box);
        }
        if (p.state === 'not_found') {
            box.innerHTML = hero({ title: '@' + nick }) + `<div class="pf-body"><div class="pf-empty">
                ${svg(ICON.user, 26)}
                <div class="mt-3">Профиля <b>@${esc(nick)}</b> нет.</div>
                <p class="pf-note">Проверьте ссылку — возможно, ник изменился.</p></div></div>`;
            return wire(box);
        }
        if (p.state !== 'ok' && p.state !== 'closed') {
            box.innerHTML = hero({ title: '@' + nick }) + `<div class="pf-body"><div class="pf-empty">
                Не удалось открыть профиль. Попробуйте позже.</div></div>`;
            return wire(box);
        }

        // ── Закрытый профиль ────────────────────────────────────────────────
        // ⚠️ Кнопка дружбы нужна и здесь: заявкой закрытый профиль и
        // открывается. И текст обязан различать «закрыт от всех» и «только
        // друзьям» — иначе другу, от которого профиль закрыли полностью,
        // предлагалось «добавиться в друзья» (фидбэк 2026-09-21).
        if (p.state === 'closed') {
            const priv = p.visibility === 'private';
            const title = priv ? 'Профиль закрыт для всех' : 'Профиль открыт только друзьям';
            const note = priv
                ? (p.friend === 'friends'
                    ? 'Владелец закрыл его полностью — даже для друзей.'
                    : 'Заявку в друзья отправить можно, но профиль откроется только если владелец изменит настройки.')
                : (p.friend === 'friends'
                    ? 'Вы друзья — профиль должен быть виден. Обновите страницу.'
                    : 'Добавьтесь в друзья — и профиль откроется.');
            box.innerHTML = hero({ person: true, nick: p.username || nick,
                                   name: p.display_name || ('@' + (p.username || nick)),
                                   avatar: p.avatar_url }) +
                `<div class="pf-body">
                    <div class="pf-closed">
                        <div class="pf-closed-t">${svg(ICON.lock, 15)}${esc(title)}</div>
                        <p class="pf-note" style="margin-top:6px">${esc(note)}</p>
                    </div>
                    <div class="pf-actions">${friendButton(p)}</div>
                </div>`;
            return wire(box);
        }

        const isSelf = p.friend === 'self';
        const done = p.done || null, planned = p.planned || null;
        const parts = [hero({ person: true, nick: p.username, name: p.display_name, avatar: p.avatar_url })];
        const body = [];

        if (p.bio) body.push(`<p class="pf-bio">${esc(p.bio)}</p>`);
        body.push(`<div class="pf-actions">${friendButton(p)}</div>`);
        if (isSelf) body.push(shareBlock());
        if (p.stats || isSelf) body.push(statsBlock(p.stats, isSelf));

        if (done) {
            body.push(section('Пройденные', done.length, done.length
                ? `<div class="pf-rows">${done.slice(0, 60).map(routeRow).join('')}</div>`
                : `<div class="pf-none">${isSelf
                    ? 'Отметьте маршрут пройденным в его карточке — он появится здесь.'
                    : 'Пока ничего'}</div>`));
        }
        if (planned) {
            body.push(section('Планируемые', planned.length, planned.length
                ? `<div class="pf-rows">${planned.map(routeRow).join('')}</div>`
                : `<div class="pf-none">Планов пока нет</div>`));
        }
        if (p.friends) {
            body.push(section('Друзья', p.friends.length, p.friends.length
                ? `<div class="pf-people">${p.friends.map(f => `
                    <button class="pf-person" data-nick="${esc(f.username || f.id || '')}">
                        ${avatar(f.avatar_url, f.display_name)}
                        <span>${esc((f.display_name || f.username || '').split(' ')[0])}</span>
                    </button>`).join('')}</div>`
                : `<div class="pf-none">Пока никого</div>`));
        }
        // Чего не видно — о том и говорим: пустота выглядит как поломка
        const hidden = [!p.stats && 'достижения', !done && 'пройденные', !planned && 'планы',
                        !p.friends && 'друзей'].filter(Boolean);
        if (hidden.length && !isSelf) {
            body.push(`<p class="pf-note pf-hidden">Владелец скрыл ${hidden.join(', ')}.</p>`);
        }

        parts.push(`<div class="pf-body">${body.join('')}</div>`);
        box.innerHTML = parts.join('');
        wire(box);
    }

    // ── Настройки профиля ───────────────────────────────────────────────────

    const levelColor = l => l === 'public' ? '#7A5EA6' : l === 'friends' ? '#FF8C00' : '#52525b';

    function visRow(f) {
        const cur = (me && me[f.key]) || 'public';
        const i = Math.max(0, LEVELS.findIndex(l => l.value === cur));
        return `<div class="pf-vis">
            <div class="pf-vis-l">${esc(f.label)}${f.hint ? `<em>${esc(f.hint)}</em>` : ''}</div>
            <div class="rs-seg pf-seg" style="--seg-n:3;--seg-i:${i};--seg-color:${levelColor(cur)}">
                <span class="rs-seg-thumb"></span>
                ${LEVELS.map(l => `<button class="rs-seg-btn${l.value === cur ? ' active' : ''}"
                    data-vis="${f.key}" data-level="${l.value}" ${busy ? 'disabled' : ''}>${l.label}</button>`).join('')}
            </div>
        </div>`;
    }

    function renderSettings() {
        const box = document.getElementById('profile-modal-inner');
        if (!box) return;
        if (!signedIn() || !me) {
            box.innerHTML = hero({ title: 'Профиль' }) +
                `<div class="pf-body"><div class="pf-empty">Войдите, чтобы настроить профиль.</div></div>`;
            return wire(box);
        }
        box.innerHTML = hero({ person: true, nick: me.username, name: me.display_name || 'Мой профиль',
                               avatar: me.avatar_url }) + `<div class="pf-body">
            ${shareBlock()}
            ${section('Ник', null, `
                <div class="pf-nickbox">
                    <span class="pf-at">@</span>
                    <input class="review-input" id="pf-nick" maxlength="20" spellcheck="false"
                           placeholder="${esc(suggestNick())}" value="${esc(me.username || '')}">
                    <button class="pf-btn pf-btn-accent" id="pf-nick-save" ${busy ? 'disabled' : ''}>Сохранить</button>
                </div>
                <div class="pf-nicknote" id="pf-nicknote">${nickNoteHTML()}</div>`)}
            ${section('О себе', null, `
                <textarea class="review-input" id="pf-bio" maxlength="280" rows="3"
                    placeholder="Пара слов — их увидят в профиле" style="resize:none;display:block">${esc(me.bio || '')}</textarea>
                <button class="pf-btn pf-btn-ghost mt-2" id="pf-bio-save" ${busy ? 'disabled' : ''}>Сохранить</button>`)}
            ${section('Кто что видит', null, FIELDS.map(visRow).join(''))}
            <div class="pf-foot">
                <button class="pf-btn pf-btn-ghost" id="pf-to-friends">${svg(ICON.users, 14)}Друзья${
                    requests.length ? ` <b class="tw-pill">${requests.length}</b>` : ''}</button>
                ${me.username ? `<button class="pf-btn pf-btn-ghost" id="pf-preview">${svg(ICON.user, 14)}Как видят другие</button>` : ''}
            </div>
        </div>`;
        wire(box);
    }

    // ── Друзья и заявки ─────────────────────────────────────────────────────

    function renderFriends() {
        const box = document.getElementById('profile-modal-inner');
        if (!box) return;
        const person = (f, extra) => `
            <div class="pf-fitem">
                <button class="pf-fmain" data-nick="${esc(f.username || f.id || '')}">
                    ${avatar(f.avatar_url, f.display_name)}
                    <span class="pf-fname">${esc(f.display_name || (f.username ? '@' + f.username : 'Без имени'))}</span>
                    ${f.username ? `<span class="pf-fnick">@${esc(f.username)}</span>` : ''}
                </button>
                ${extra || ''}
            </div>`;

        box.innerHTML = hero({ title: 'Друзья' }) + `<div class="pf-body">
            ${requests.length ? section('Заявки', requests.length,
                requests.map(r => person(r, `
                    <div class="pf-fbtns">
                        <button class="pf-btn pf-btn-accent pf-btn-sm" data-accept="${esc(r.id)}" ${busy ? 'disabled' : ''}>Принять</button>
                        <button class="pf-link" data-decline="${esc(r.id)}" ${busy ? 'disabled' : ''}>отклонить</button>
                    </div>`)).join('')) : ''}
            ${section('Мои друзья', friends.length, friends.length
                ? friends.map(f => person(f)).join('')
                : `<div class="pf-none">Пока никого. Профилем делятся ссылкой или QR-кодом — они ниже.</div>`)}
            ${shareBlock()}
        </div>`;
        wire(box);
    }

    // ── QR и ссылка ─────────────────────────────────────────────────────────

    /**
     * QR рисуем **у себя**, библиотекой в `libs/` (55 КБ, грузится по первому
     * показу). Через чужой сервис-генератор ссылка на профиль уезжала бы
     * третьей стороне, и её пришлось бы вписывать в политику
     * конфиденциальности — ради картинки, которую рисуют за три миллисекунды.
     */
    async function showQR() {
        const box = document.getElementById('pf-qr-box');
        if (!box || !me || !me.username) return;
        if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
        box.classList.remove('hidden');
        box.innerHTML = '<span class="pf-note">Рисую код…</span>';
        try {
            if (!window.qrcode) {
                if (!qrLoading) qrLoading = _loadScript(QR_SDK);
                await qrLoading;
            }
            const q = qrcode(0, 'M');
            q.addData(profileLink(me.username));
            q.make();
            const n = q.getModuleCount();
            const cell = 6, pad = 4;
            const px = (n + pad * 2) * cell;
            const cv = document.createElement('canvas');
            cv.width = cv.height = px * 2;            // ×2 — чтобы наводили телефоном
            cv.style.width = cv.style.height = px + 'px';
            const ctx = cv.getContext('2d');
            ctx.scale(2, 2);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, px, px);
            ctx.fillStyle = '#0a0a0a';
            for (let r = 0; r < n; r++) {
                for (let c = 0; c < n; c++) {
                    if (q.isDark(r, c)) ctx.fillRect((c + pad) * cell, (r + pad) * cell, cell, cell);
                }
            }
            box.innerHTML = '';
            box.appendChild(cv);
            const save = document.createElement('button');
            save.className = 'pf-link';
            save.textContent = 'скачать картинку';
            save.onclick = () => {
                const a = document.createElement('a');
                a.href = cv.toDataURL('image/png');
                a.download = `totskii-wild-${me.username}.png`;
                document.body.appendChild(a); a.click(); a.remove();
            };
            box.appendChild(save);
        } catch (e) {
            console.warn('[profile] QR:', e);
            box.innerHTML = '<span class="pf-note">Не удалось нарисовать код</span>';
        }
    }

    async function copyLink() {
        if (!me || !me.username) return;
        const link = profileLink(me.username);
        try {
            await navigator.clipboard.writeText(link);
            toast('Ссылка скопирована');
        } catch (e) {
            // Без https и без разрешения clipboard остаётся старый способ
            const input = document.getElementById('pf-link');
            if (input) { input.select(); document.execCommand('copy'); toast('Ссылка скопирована'); }
        }
    }

    async function saveNick(value) {
        const v = String(value || '').trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(v)) { toast('Ник: 3–20 символов, латиница, цифры, подчёркивание'); return; }
        if (me && v === me.username) return;
        if (await saveProfile({ username: v })) {
            nickState = null;
            toast('Ник сохранён');
        }
    }

    // ── Обработчики ─────────────────────────────────────────────────────────

    function wire(box) {
        const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
        on('#pf-close', close);
        on('#pf-back', back);
        on('#pf-signin', () => { close(); Account.openModal(); });
        on('#pf-to-settings', () => push({ kind: 'settings' }));
        on('#pf-to-friends', () => push({ kind: 'friends' }));
        on('#pf-preview', () => openUser(me.username));
        on('#pf-copy', copyLink);
        on('#pf-qr', showQR);

        box.querySelectorAll('[data-friend]').forEach(b => {
            b.onclick = () => friendAction(b.dataset.friend);
        });
        box.querySelectorAll('[data-nick]').forEach(b => {
            b.onclick = () => openUser(b.dataset.nick);
        });
        box.querySelectorAll('[data-accept]').forEach(b => {
            b.onclick = () => respondRequest(b.dataset.accept, true);
        });
        box.querySelectorAll('[data-decline]').forEach(b => {
            b.onclick = () => respondRequest(b.dataset.decline, false);
        });
        box.querySelectorAll('[data-vis]').forEach(b => {
            b.onclick = async () => {
                // Пилюля переезжает сразу, как в блоке статуса маршрута, —
                // и возвращается, если база не приняла
                const seg = b.closest('.rs-seg');
                const btns = [...seg.querySelectorAll('.rs-seg-btn')];
                const was = { i: seg.style.getPropertyValue('--seg-i'),
                              color: seg.style.getPropertyValue('--seg-color'),
                              level: me ? me[b.dataset.vis] : null,
                              active: seg.querySelector('.rs-seg-btn.active') };
                seg.style.setProperty('--seg-i', btns.indexOf(b));
                seg.style.setProperty('--seg-color', levelColor(b.dataset.level));
                btns.forEach(x => x.classList.toggle('active', x === b));
                if (me) me[b.dataset.vis] = b.dataset.level;
                if (await saveProfile({ [b.dataset.vis]: b.dataset.level }, false)) return;
                seg.style.setProperty('--seg-i', was.i);
                seg.style.setProperty('--seg-color', was.color);
                btns.forEach(x => x.classList.toggle('active', x === was.active));
                if (me) me[b.dataset.vis] = was.level;
            };
        });

        const nickInput = box.querySelector('#pf-nick');
        if (nickInput) {
            nickInput.oninput = () => checkNick(nickInput.value);
            nickInput.onkeydown = e => { if (e.key === 'Enter') saveNick(nickInput.value); };
        }
        on('#pf-nick-save', () => saveNick(box.querySelector('#pf-nick').value));
        on('#pf-bio-save', async () => {
            const v = box.querySelector('#pf-bio').value.trim().slice(0, 280);
            if (await saveProfile({ bio: v || null })) toast('Сохранено');
        });

        // Маршрут из списка: каталожный открываем сразу, чужой — по ссылке
        box.querySelectorAll('.pf-row[data-key], .pf-row[data-shared]').forEach(b => {
            b.onclick = () => {
                const key = b.dataset.key, shared = b.dataset.shared;
                if (key && window.routes && routes[key]) { close(); triggerRouteSelection(key); return; }
                if (shared) { close(); location.hash = 'shared_' + shared; return; }
            };
        });
    }

    // ── Запуск ──────────────────────────────────────────────────────────────

    /** `#u/<ник>` — ссылка на чужой профиль, входа не требует. */
    function openFromHash() {
        if (!location.hash.startsWith(HASH)) return false;
        fromAccount = false;        // пришли по ссылке, а не из своего окна
        stack = [];
        openUser(location.hash.slice(HASH.length));
        return true;
    }

    function onAccount() {
        if (!signedIn()) {
            me = null; requests = []; friends = []; loadedFor = null;
            const t = top();
            // Свои экраны без сессии смысла не имеют; чужой профиль — имеет
            if (t && t.kind !== 'public') close();
            return;
        }
        load();
    }

    function init() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && view) close();
        });
        window.addEventListener('hashchange', openFromHash);
        openFromHash();
    }

    window.Profile = {
        open, close, openUser, onAccount, openFromHash,
        /** Сколько заявок ждёт ответа — для точки на кнопке профиля */
        requestCount() { return requests.length; },
        nick() { return me && me.username ? me.username : null; }
    };

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
