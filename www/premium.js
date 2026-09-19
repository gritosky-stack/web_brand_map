/**
 * Закрытые функции сайта: историческая карта и скачивание GPX маршрутов
 * каталога.
 *
 * Пока они открыты только двум адресам (`ALLOWED`) — дальше их будет
 * открывать подписка. Без входа через Google показываем приглашение войти,
 * вошедшим не из списка — плашку «в работе».
 *
 * ⚠️ Это замок в интерфейсе, а не защита данных: тайлы гравюры лежат в
 * публичном R2, а GPX каталога — рядом со страницей. Когда появится
 * подписка, проверять её придётся на сервере (Supabase), а не здесь.
 *
 * Зависит от account.js: `Account.status()`, `Account.email()`,
 * `Account.signInWithGoogle()`, событие `tw-account`.
 */
(function () {
    'use strict';

    const ALLOWED = ['gritosky@gmail.com', 'gritskij@gmail.com'];

    const FEATURES = {
        histmap: {
            icon: '🗺',
            title: 'Историческая карта',
            pitch: 'Австро-венгерская «Спецкарта» 1:75 000, снятая в 1900-х–1910-х, поверх современной.'
        },
        gpx: {
            icon: '⬇️',
            title: 'Скачать GPX маршрута',
            pitch: 'Трек маршрута в навигатор, часы или OsmAnd — чтобы пройти его самому.'
        }
    };

    function allowed() {
        const email = window.Account && Account.email && Account.email();
        return !!email && ALLOWED.includes(email);
    }

    function signedIn() {
        return !!(window.Account && Account.email && Account.email());
    }

    // Шестерёнка и ключ — «идут работы». Шестерёнка медленно крутится
    const WORKS_ICON = `
        <svg class="pm-works" width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <g class="pm-gear" style="transform-origin:20px 20px">
                <path d="M20 8.5l2.1.3.8 3.1 2.2.9 2.8-1.6 1.7 1.3-.9 3.1 1.4 1.9 3.2.3.6 2.1-2.6 1.9v2.4l2.6 1.9-.6 2.1-3.2.3-1.4 1.9.9 3.1-1.7 1.3-2.8-1.6-2.2.9-.8 3.1-2.1.3-2.1-.3-.8-3.1-2.2-.9-2.8 1.6-1.7-1.3.9-3.1-1.4-1.9-3.2-.3-.6-2.1 2.6-1.9v-2.4l-2.6-1.9.6-2.1 3.2-.3 1.4-1.9-.9-3.1 1.7-1.3 2.8 1.6 2.2-.9.8-3.1z"
                      stroke="#FFB347" stroke-width="1.8" stroke-linejoin="round"/>
                <circle cx="20" cy="20" r="4.5" stroke="#FFB347" stroke-width="1.8"/>
            </g>
            <path d="M42.5 30.5a5.5 5.5 0 01-7.3 5.2l-7.4 7.4a2.3 2.3 0 01-3.2-3.2l7.4-7.4a5.5 5.5 0 016.6-7.1l-3.3 3.3.6 2.5 2.5.6 3.3-3.3c.5.6.8 1.3.8 2z"
                  fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.75)" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`;

    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function ensureModal() {
        let el = document.getElementById('premium-modal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'premium-modal';
        el.className = 'tw-modal';
        el.innerHTML = '<div class="tw-modal-inner pm-inner"></div>';
        el.addEventListener('click', e => { if (e.target === el) close(); });
        document.body.appendChild(el);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
        return el;
    }

    function close() {
        const el = document.getElementById('premium-modal');
        if (el) el.classList.remove('open');
    }

    /**
     * Плашка вместо функции. Без входа — сначала войти: список адресов
     * проверяется по почте, и не вошедшему мы просто не знаем, кто он.
     */
    function showPlate(key) {
        const f = FEATURES[key] || { icon: '🔒', title: 'Функция', pitch: '' };
        const el = ensureModal();
        const inner = el.querySelector('.pm-inner');
        const unavailable = window.Account && Account.status && Account.status() === 'unavailable';

        if (!signedIn() && !unavailable) {
            inner.innerHTML = `
                <div class="pm-head">
                    <div class="pm-badge">${f.icon}</div>
                    <div>
                        <div class="pm-title">${esc(f.title)}</div>
                        <div class="pm-sub">Нужен вход</div>
                    </div>
                </div>
                <p class="tw-note mb-4">${esc(f.pitch)} Функция доступна после входа через Google.</p>
                <button class="tw-btn tw-btn-google" data-act="login">Войти через Google</button>
                <button class="tw-btn tw-btn-ghost mt-2" data-act="close">Не сейчас</button>`;
        } else {
            inner.innerHTML = `
                <div class="pm-head">
                    <div class="pm-badge pm-badge-works">${WORKS_ICON}</div>
                    <div>
                        <div class="pm-title">${esc(f.title)}</div>
                        <div class="pm-sub pm-sub-works">В работе</div>
                    </div>
                </div>
                <p class="tw-note mb-2">${esc(f.pitch)}</p>
                <p class="tw-note mb-4">Мы доводим её до ума и скоро откроем. Загляните чуть позже.</p>
                <button class="tw-btn tw-btn-ghost" data-act="close">Понятно</button>`;
        }
        inner.querySelectorAll('[data-act]').forEach(b => {
            b.onclick = () => {
                if (b.dataset.act === 'login' && window.Account) Account.signInWithGoogle();
                else close();
            };
        });
        el.classList.add('open');
    }

    /** Можно ли пользоваться. Нельзя — показываем плашку и возвращаем false. */
    function require(key) {
        if (allowed()) return true;
        showPlate(key);
        return false;
    }

    window.Premium = { allowed, require, showPlate, close };
})();
