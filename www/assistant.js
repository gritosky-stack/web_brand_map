/* ────────────────────────────────────────────────────────────────
 * assistant.js — AI-ассистент подбора маршрутов
 *
 * Аддитивный модуль. Создаёт UI динамически, ничего не ломает.
 * Зависит от: window.RouteMatcher, window.routes, window.parsedRouteDataCache,
 *             window.triggerRouteSelection
 * Подключается ПОСЛЕ script.js.
 * ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const SUGGESTIONS = [
    'лёгкий на выходные рядом с Белградом',
    'kružna staza do 15 km',
    'до 10 км, простой',
    'сложный с большим набором',
    'тропа на Тару',
  ];

  let pssRoutes = [];       // loaded from routes_index.json
  let panelOpen = false;
  let lastQuery = '';

  // ── Inject styles ──────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('asst-styles')) return;
    const s = document.createElement('style');
    s.id = 'asst-styles';
    s.textContent = `
      /* ── Top search bar ─────────────────────────────── */
      #asst-search-bar {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 35;
        width: min(440px, calc(100vw - 32px));
        display: none; /* desktop only */
        pointer-events: auto;
      }
      @media (min-width: 768px) {
        #asst-search-bar { display: block; top: 26px; }
      }
      #asst-search-input-wrap {
        display: flex; align-items: center; gap: 8px;
        background: rgba(12,12,14,0.92);
        border: 1px solid rgba(63,63,70,0.55);
        border-radius: 999px;
        padding: 7px 10px 7px 14px;
        box-shadow: 0 6px 24px rgba(0,0,0,.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        transition: border-color .2s, box-shadow .2s;
      }
      #asst-search-input-wrap:focus-within {
        border-color: rgba(255,77,77,.55);
        box-shadow: 0 6px 24px rgba(0,0,0,.55), 0 0 0 1px rgba(255,77,77,.3);
      }
      #asst-search-input {
        flex: 1;
        background: transparent; border: none; outline: none;
        color: #fff; font-size: 13px;
        padding: 4px 0;
      }
      #asst-search-input::placeholder { color: rgba(255,255,255,.32); }
      #asst-search-go {
        background: rgba(255,77,77,.85); color: #fff;
        border: none; cursor: pointer;
        border-radius: 999px;
        height: 30px; padding: 0 14px;
        font-size: 11px; font-weight: 600; letter-spacing: .04em;
        transition: background .15s;
      }
      #asst-search-go:hover { background: rgba(255,77,77,1); }
      #asst-search-go:disabled { opacity: .4; cursor: not-allowed; }

      /* ── FAB ───────────────────────────────────────────── */
      #asst-fab {
        position: fixed;
        z-index: 30;
        right: 14px;
        bottom: 70px; /* above #btn-layers-toggle (bottom: 20px, h: 40px) */
        width: 52px; height: 52px;
        border-radius: 999px;
        background: linear-gradient(145deg, #ff6b3d, #ff4d4d);
        border: none; cursor: pointer;
        color: white;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 24px rgba(255,77,77,.45), 0 2px 8px rgba(0,0,0,.5);
        transition: transform .15s, box-shadow .2s;
        pointer-events: auto;
      }
      #asst-fab:hover { transform: scale(1.06); box-shadow: 0 6px 28px rgba(255,77,77,.6); }
      #asst-fab:active { transform: scale(.94); }
      @media (min-width: 768px) {
        #asst-fab { bottom: 220px; }
      }

      /* ── Backdrop ───────────────────────────────────── */
      #asst-backdrop {
        position: fixed; inset: 0; z-index: 109;
        background: rgba(0,0,0,.5);
        opacity: 0; pointer-events: none;
        transition: opacity .25s ease;
      }
      #asst-backdrop.open { opacity: 1; pointer-events: auto; }

      /* ── Panel ──────────────────────────────────────── */
      #asst-panel {
        position: fixed;
        z-index: 110;
        background: rgba(9,9,11,.96);
        border: 1px solid rgba(63,63,70,.55);
        box-shadow: 0 12px 60px rgba(0,0,0,.8);
        display: flex; flex-direction: column;
        pointer-events: auto;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      /* Desktop — centered overlay */
      @media (min-width: 768px) {
        #asst-panel {
          top: 50%; left: 50%;
          transform: translate(-50%, -48%) scale(.96);
          width: 520px; max-width: 92vw;
          max-height: 78vh;
          border-radius: 22px;
          opacity: 0; pointer-events: none;
          transition: opacity .25s ease, transform .3s cubic-bezier(.2,.8,.3,1);
        }
        #asst-panel.open {
          opacity: 1; transform: translate(-50%, -50%) scale(1);
          pointer-events: auto;
        }
      }
      /* Mobile — bottom sheet */
      @media (max-width: 767px) {
        #asst-panel {
          left: 0; right: 0; bottom: 0;
          height: 82vh; max-height: 82vh;
          border-radius: 22px 22px 0 0;
          border-bottom: none;
          transform: translateY(calc(100% + 16px));
          transition: transform .35s cubic-bezier(.2,.8,.3,1);
        }
        #asst-panel.open { transform: translateY(0); }
      }

      /* ── Panel header ───────────────────────────────── */
      #asst-panel-header {
        padding: 16px 18px 14px;
        border-bottom: 1px solid rgba(63,63,70,.55);
        display: flex; align-items: center; gap: 12px;
        flex-shrink: 0;
      }
      #asst-panel-title {
        flex: 1;
        font-size: 14px; font-weight: 600;
        color: #fff;
        letter-spacing: -.01em;
      }
      #asst-panel-title-tag {
        display: inline-block;
        background: rgba(255,77,77,.15);
        color: #ff4d4d;
        font-size: 9px; font-weight: 700;
        letter-spacing: .08em; text-transform: uppercase;
        border-radius: 999px;
        padding: 3px 8px;
        margin-right: 8px;
        vertical-align: 2px;
      }
      #asst-panel-close {
        flex-shrink: 0;
        width: 32px; height: 32px;
        border-radius: 999px;
        background: rgba(255,255,255,.1);
        border: none; cursor: pointer;
        color: white;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      #asst-panel-close:hover { background: rgba(255,255,255,.2); }

      /* ── Input row inside panel ─────────────────────── */
      #asst-panel-input-wrap {
        padding: 14px 18px;
        border-bottom: 1px solid rgba(63,63,70,.4);
        flex-shrink: 0;
        display: flex; gap: 8px;
      }
      #asst-panel-input {
        flex: 1;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        padding: 10px 14px;
        color: #fff; font-size: 13px;
        outline: none;
        transition: border-color .2s, background .2s;
        font-family: inherit;
      }
      #asst-panel-input:focus { border-color: rgba(255,77,77,.55); background: rgba(255,255,255,.09); }
      #asst-panel-input::placeholder { color: rgba(255,255,255,.3); }
      #asst-panel-go {
        background: rgba(255,77,77,.85);
        color: #fff;
        border: none; cursor: pointer;
        border-radius: 12px;
        padding: 0 18px;
        font-size: 12px; font-weight: 600;
        transition: background .15s;
      }
      #asst-panel-go:hover { background: rgba(255,77,77,1); }

      /* ── Body / scroll area ─────────────────────────── */
      #asst-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 18px 24px;
      }
      #asst-panel-body::-webkit-scrollbar { display: none; }
      #asst-panel-body { -ms-overflow-style: none; scrollbar-width: none; }

      /* ── Suggestion chips ──────────────────────────── */
      .asst-suggest-label {
        font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: .08em;
        color: rgba(255,255,255,.45);
        margin-bottom: 12px;
      }
      .asst-suggest-chips {
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-bottom: 20px;
      }
      .asst-chip {
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.1);
        color: rgba(255,255,255,.75);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: background .15s, border-color .15s, color .15s;
      }
      .asst-chip:hover {
        background: rgba(255,77,77,.12);
        border-color: rgba(255,77,77,.4);
        color: #fff;
      }

      /* ── Thinking spinner ──────────────────────────── */
      .asst-thinking {
        display: flex; align-items: center; gap: 12px;
        padding: 14px 0;
        color: rgba(255,255,255,.5);
        font-size: 13px;
      }
      .asst-spinner {
        width: 16px; height: 16px;
        border: 2px solid rgba(255,77,77,.2);
        border-top-color: #ff4d4d;
        border-radius: 50%;
        animation: asst-spin 0.7s linear infinite;
      }
      @keyframes asst-spin { to { transform: rotate(360deg); } }

      /* ── Result cards ──────────────────────────────── */
      .asst-result {
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 16px;
        padding: 14px 16px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: background .15s, border-color .15s, transform .12s;
      }
      .asst-result:hover {
        background: rgba(255,255,255,.08);
        border-color: rgba(255,255,255,.15);
        transform: translateY(-1px);
      }
      .asst-result-head {
        display: flex; align-items: flex-start;
        justify-content: space-between; gap: 10px;
        margin-bottom: 8px;
      }
      .asst-result-name {
        font-size: 14px; font-weight: 600;
        color: #fff;
        letter-spacing: -.01em;
        line-height: 1.3;
      }
      .asst-result-source {
        flex-shrink: 0;
        font-size: 9px; font-weight: 700;
        letter-spacing: .08em; text-transform: uppercase;
        border-radius: 999px;
        padding: 2px 8px;
      }
      .asst-result-source.curated {
        background: rgba(255,77,77,.18);
        color: #ff4d4d;
        border: 1px solid rgba(255,77,77,.3);
      }
      .asst-result-source.pss {
        background: rgba(52,170,223,.14);
        color: #52c1f4;
        border: 1px solid rgba(52,170,223,.3);
      }
      .asst-result-stats {
        display: flex; gap: 14px; flex-wrap: wrap;
        font-size: 12px; color: rgba(255,255,255,.6);
        margin-bottom: 8px;
        font-variant-numeric: tabular-nums;
      }
      .asst-result-stats span { display: inline-flex; align-items: center; gap: 4px; }
      .asst-result-stats strong { color: #fff; font-weight: 600; }
      .asst-diff-badge {
        display: inline-block;
        font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .06em;
        border-radius: 999px;
        padding: 2px 8px;
        border: 1px solid;
      }
      .asst-diff-lak    { background: rgba(76,175,80,.14); color: #6FCB72; border-color: rgba(76,175,80,.4); }
      .asst-diff-umeren { background: rgba(255,152,0,.14); color: #FFB142; border-color: rgba(255,152,0,.4); }
      .asst-diff-tezak  { background: rgba(244,67,54,.14); color: #FF7B73; border-color: rgba(244,67,54,.4); }
      .asst-diff-vrlo   { background: rgba(156,39,176,.14); color: #C77CD9; border-color: rgba(156,39,176,.4); }
      .asst-result-reasons {
        font-size: 11px;
        color: rgba(255,255,255,.5);
        line-height: 1.5;
        padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,.06);
        margin-top: 4px;
      }
      .asst-result-reasons strong {
        color: #6FCB72;
        font-weight: 600;
        margin-right: 4px;
      }

      /* ── Empty / no-results state ──────────────────── */
      .asst-no-results {
        text-align: center;
        padding: 32px 16px;
        color: rgba(255,255,255,.45);
        font-size: 13px;
      }
      .asst-no-results-icon {
        font-size: 28px;
        margin-bottom: 8px;
        opacity: .5;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Build DOM ──────────────────────────────────────────────
  function buildDOM() {
    if (document.getElementById('asst-fab')) return;

    // Top search bar (desktop)
    const bar = document.createElement('div');
    bar.id = 'asst-search-bar';
    bar.innerHTML = `
      <div id="asst-search-input-wrap">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1 L7.8 4.6 L11.4 4.4 L8.4 6.8 L10 10.2 L7 8 L4 10.2 L5.6 6.8 L2.6 4.4 L6.2 4.6 Z"
            fill="rgba(255,77,77,.85)" stroke="rgba(255,77,77,.4)" stroke-width=".6"/>
        </svg>
        <input id="asst-search-input" type="text" autocomplete="off"
          placeholder="Опиши маршрут — лёгкий на выходные…"
          aria-label="Поиск маршрута по описанию">
        <button id="asst-search-go" aria-label="Найти">Найти</button>
      </div>
    `;
    document.body.appendChild(bar);

    // FAB
    const fab = document.createElement('button');
    fab.id = 'asst-fab';
    fab.setAttribute('aria-label', 'Помощник подбора маршрутов');
    fab.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path d="M11 1 L12.6 7.6 L19.2 9.2 L13.8 12.4 L15.4 19 L11 14.8 L6.6 19 L8.2 12.4 L2.8 9.2 L9.4 7.6 Z"
          fill="white"/>
      </svg>
    `;
    document.body.appendChild(fab);

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'asst-backdrop';
    document.body.appendChild(backdrop);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'asst-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Подбор маршрутов');
    panel.innerHTML = `
      <div id="asst-panel-header">
        <div id="asst-panel-title">
          <span id="asst-panel-title-tag">AI</span>Подбор маршрута
        </div>
        <button id="asst-panel-close" aria-label="Закрыть">
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <path d="M1 1 L10 10 M10 1 L1 10" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div id="asst-panel-input-wrap">
        <input id="asst-panel-input" type="text" autocomplete="off"
          placeholder="Опиши, что ищешь…"
          aria-label="Поиск маршрута">
        <button id="asst-panel-go" aria-label="Найти">Найти</button>
      </div>
      <div id="asst-panel-body"></div>
    `;
    document.body.appendChild(panel);

    // Wire events
    fab.addEventListener('click', () => openPanel());
    backdrop.addEventListener('click', () => closePanel());
    document.getElementById('asst-panel-close').addEventListener('click', () => closePanel());

    const topInput = document.getElementById('asst-search-input');
    const topGo = document.getElementById('asst-search-go');
    topGo.addEventListener('click', () => {
      const q = topInput.value.trim();
      if (q) { openPanel(q); }
      else { openPanel(); }
    });
    topInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = topInput.value.trim();
        if (q) openPanel(q);
      }
    });
    topInput.addEventListener('focus', () => {
      // open panel when user focuses top bar (but keep typing in panel input synced)
    });

    const panelInput = document.getElementById('asst-panel-input');
    const panelGo = document.getElementById('asst-panel-go');
    panelGo.addEventListener('click', () => {
      const q = panelInput.value.trim();
      if (q) runSearch(q);
    });
    panelInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = panelInput.value.trim();
        if (q) runSearch(q);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panelOpen) closePanel();
    });
  }

  // ── Open / close ────────────────────────────────────────────
  function openPanel(initialQuery) {
    panelOpen = true;
    document.getElementById('asst-backdrop').classList.add('open');
    document.getElementById('asst-panel').classList.add('open');
    if (initialQuery) {
      document.getElementById('asst-panel-input').value = initialQuery;
      runSearch(initialQuery);
    } else {
      renderEmpty();
      setTimeout(() => document.getElementById('asst-panel-input').focus(), 300);
    }
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById('asst-backdrop').classList.remove('open');
    document.getElementById('asst-panel').classList.remove('open');
  }

  // ── Empty state ────────────────────────────────────────────
  function renderEmpty() {
    const body = document.getElementById('asst-panel-body');
    body.innerHTML = `
      <div class="asst-suggest-label">Попробуй так</div>
      <div class="asst-suggest-chips">
        ${SUGGESTIONS.map(s => `<button class="asst-chip" data-q="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join('')}
      </div>
      <div style="color:rgba(255,255,255,.4); font-size:12px; line-height:1.6;">
        Введи запрос на любом языке — русский, сербский, английский.<br>
        Учитываются сложность, длина, расстояние от города и многое другое.
      </div>
    `;
    body.querySelectorAll('.asst-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        document.getElementById('asst-panel-input').value = q;
        runSearch(q);
      });
    });
  }

  // ── Build candidate list ───────────────────────────────────
  function buildCandidates() {
    const candidates = [...pssRoutes];

    // Curated routes from window.routes + parsedRouteDataCache
    if (window.routes && window.parsedRouteDataCache) {
      Object.keys(window.routes).forEach(routeId => {
        const info = window.routes[routeId];
        const data = window.parsedRouteDataCache[routeId];
        if (!info || !data || !data.distance) return;
        const dist = data.distance;
        const ascent = (info.overrideAscent != null) ? info.overrideAscent : (data.ascent || 0);
        const score = dist + ascent / 100;
        let difficulty = 'lak';
        if (score >= 32) difficulty = 'vrlo težak';
        else if (score >= 20) difficulty = 'težak';
        else if (score >= 10) difficulty = 'umeren';

        // Start coord
        let start = null;
        if (data.startCoord && data.startCoord.length === 2) start = data.startCoord;
        else if (data.coordinates && data.coordinates[0]) {
          const c = data.coordinates[0];
          start = Array.isArray(c) ? [c[0], c[1]] : null;
        }

        candidates.push({
          name: info.name,
          distance_km: Math.round(dist * 10) / 10,
          ascent_m: Math.round(ascent),
          difficulty,
          start: start || [20.4612, 44.8125], // fallback Belgrade
          _routeId: routeId,
        });
      });
    }

    return candidates;
  }

  // ── Run search ─────────────────────────────────────────────
  function runSearch(query) {
    if (!query || !window.RouteMatcher) return;
    lastQuery = query;

    const body = document.getElementById('asst-panel-body');
    body.innerHTML = `
      <div class="asst-thinking">
        <div class="asst-spinner"></div>
        <span>Подбираю маршруты для «${escapeHtml(query)}»…</span>
      </div>
    `;

    // Small delay so user sees the spinner — feels intentional
    setTimeout(() => {
      try {
        const candidates = buildCandidates();
        const { results } = window.RouteMatcher.matchRoutes(query, candidates, { limit: 5 });
        renderResults(results);
      } catch (err) {
        console.error('Assistant search error', err);
        body.innerHTML = `<div class="asst-no-results">
          <div class="asst-no-results-icon">⚠️</div>
          Ошибка поиска. Попробуй переформулировать.
        </div>`;
      }
    }, 280);
  }

  // ── Render results ─────────────────────────────────────────
  function renderResults(results) {
    const body = document.getElementById('asst-panel-body');
    if (!results || results.length === 0) {
      body.innerHTML = `<div class="asst-no-results">
        <div class="asst-no-results-icon">🥾</div>
        Ничего не нашлось.<br>
        <span style="font-size:11px; opacity:.7;">Попробуй другой запрос или убери ограничения</span>
      </div>`;
      return;
    }

    const html = results.map((r, i) => renderResultCard(r, i)).join('');
    body.innerHTML = `
      <div class="asst-suggest-label">Подобрано · ${results.length}</div>
      ${html}
    `;

    body.querySelectorAll('.asst-result').forEach((el, i) => {
      el.addEventListener('click', () => handleResultClick(results[i].route));
    });
  }

  function renderResultCard(result, idx) {
    const r = result.route;
    const isCurated = !!r._routeId;
    const diffKey = (r.difficulty || '').includes('vrlo') ? 'vrlo'
      : (r.difficulty === 'težak' ? 'tezak'
      : (r.difficulty === 'umeren' ? 'umeren' : 'lak'));
    const diffLabel = { 'lak':'Лёгкий', 'umeren':'Средний', 'tezak':'Сложный', 'vrlo':'Очень сложный' }[diffKey];

    const stats = [];
    if (r.distance_km) stats.push(`<span>↔ <strong>${(+r.distance_km).toFixed(1)}</strong> км</span>`);
    if (r.ascent_m)    stats.push(`<span>↑ <strong>${Math.round(r.ascent_m)}</strong> м</span>`);
    if (r.duration_h)  stats.push(`<span>⏱ <strong>${(+r.duration_h).toFixed(1)}</strong> ч</span>`);

    const mountainLine = r.mountain ? `<span style="color:rgba(255,255,255,.4);">${escapeHtml(r.mountain)}</span>` : '';

    const reasons = (result.reasons || []).slice(0, 3);

    return `
      <div class="asst-result" tabindex="0" role="button" aria-label="${escapeAttr(r.name)}">
        <div class="asst-result-head">
          <div>
            <div class="asst-result-name">${escapeHtml(r.name)}</div>
            ${mountainLine ? `<div style="font-size:11px; color:rgba(255,255,255,.4); margin-top:2px;">${mountainLine}</div>` : ''}
          </div>
          <div class="asst-result-source ${isCurated ? 'curated' : 'pss'}">
            ${isCurated ? 'TOTSKII' : 'PSS'}
          </div>
        </div>
        <div class="asst-result-stats">
          ${stats.join('')}
          <span class="asst-diff-badge asst-diff-${diffKey}">${diffLabel}</span>
        </div>
        ${reasons.length ? `<div class="asst-result-reasons">
          ${reasons.map(rsn => `<div><strong>✓</strong>${escapeHtml(rsn)}</div>`).join('')}
        </div>` : ''}
      </div>
    `;
  }

  // ── Result click ──────────────────────────────────────────
  function handleResultClick(route) {
    if (route._routeId && typeof window.triggerRouteSelection === 'function') {
      closePanel();
      window.triggerRouteSelection(route._routeId);
    } else if (route.slug && typeof window.showPSSRoute === 'function') {
      // PSS route — draw it on our own map, don't send the user off-site
      closePanel();
      window.showPSSRoute(route.slug);
    } else if (route.url) {
      window.open(route.url, '_blank', 'noopener,noreferrer');
    }
  }

  // ── Utils ─────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ── Load PSS routes index ─────────────────────────────────
  function loadPssRoutes() {
    fetch('routes_index.json')
      .then(r => r.ok ? r.json() : [])
      .then(data => { pssRoutes = Array.isArray(data) ? data : []; })
      .catch(() => { pssRoutes = []; });
  }

  // ── Bootstrap ─────────────────────────────────────────────
  function bootstrap() {
    if (!window.RouteMatcher) {
      console.warn('[assistant] RouteMatcher not loaded — skipping init');
      return;
    }
    injectStyles();
    buildDOM();
    loadPssRoutes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
