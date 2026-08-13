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
  let pssLoad = null;       // in-flight load promise
  let panelOpen = false;
  let lastQuery = '';

  // ── Picker state ───────────────────────────────────────────
  let homeTab = 'facets';   // 'facets' | 'pss'
  let pssQuery = '';
  let resultsVisible = 5;   // how many result cards are revealed
  const facets = { diff: new Set(), regions: new Set(), distIdx: 0, durIdx: 0, typeIdx: 0 };

  const DIFFS = [['easy', 'Лёгкий'], ['medium', 'Средний'], ['hard', 'Сложный'], ['expert', 'Экспертный']];
  const DIST_LABELS = ['Любая', 'до 10 км', '10–20 км', '20–35 км', '35+ км'];
  const DUR_LABELS  = ['Любое', 'до 4 ч', '4–8 ч', '8+ ч'];
  const TYPE_LABELS = ['Любой', 'Кольцевой', 'Линейный', 'Трансверзала'];

  const DIFF_BADGE = { easy: 'lak', medium: 'umeren', hard: 'tezak', expert: 'vrlo' };
  const DIFF_COLOR = { easy: '#4CAF50', medium: '#FF9800', hard: '#F44336', expert: '#9C27B0' };

  function buildFacetFilters() {
    const f = { difficulty: new Set(facets.diff), regions: new Set(facets.regions), categories: new Set() };
    switch (facets.distIdx) {
      case 1: f.distanceMax = 10; break;
      case 2: f.distanceMin = 10; f.distanceMax = 20; break;
      case 3: f.distanceMin = 20; f.distanceMax = 35; break;
      case 4: f.distanceMin = 35; break;
    }
    switch (facets.durIdx) {
      case 1: f.durationMax = 4; break;
      case 2: f.durationMin = 4; f.durationMax = 8; break;
      case 3: f.durationMin = 8; break;
    }
    switch (facets.typeIdx) {
      case 1: f.categories = new Set(['kružna']); break;
      case 2: f.categories = new Set(['linijska']); break;
      case 3: f.categories = new Set(['transverzala', 'E-transverzala']); break;
    }
    return f;
  }

  function regionOptions() {
    return Array.from(new Set(pssRoutes.map(r => r.region).filter(Boolean))).sort();
  }

  // ── Inject styles ──────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('asst-styles')) return;
    const s = document.createElement('style');
    s.id = 'asst-styles';
    s.textContent = `
      /* ── Top search bar ─────────────────────────────── */
      #asst-search-bar {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 35;
        width: min(440px, calc(100vw - 80px));
        display: block;
        pointer-events: auto;
      }
      @media (min-width: 768px) {
        #asst-search-bar { top: 26px; width: min(440px, calc(100vw - 32px)); }
      }
      /* На мобильных плашка ложится поверх логотипа, а то же самое доступно
         в кнопке ИИ-подбора внизу справа — поэтому прячем. */
      @media (max-width: 767px) {
        #asst-search-bar { display: none; }
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

      /* ── Segmented control (Параметры / Все PSS) ─────── */
      .asst-seg {
        display: flex; gap: 4px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        padding: 4px;
        margin-bottom: 18px;
      }
      .asst-seg-btn {
        flex: 1;
        background: transparent; border: none; cursor: pointer;
        color: rgba(255,255,255,.55);
        font-size: 12px; font-weight: 600;
        font-family: inherit;
        padding: 8px 6px; border-radius: 9px;
        transition: background .15s, color .15s;
      }
      .asst-seg-btn.active { background: rgba(255,77,77,.9); color: #fff; }

      /* ── Facet groups ───────────────────────────────── */
      .asst-facet-group { margin-bottom: 16px; }
      .asst-facet-label {
        font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .08em;
        color: rgba(255,255,255,.4);
        margin-bottom: 8px;
      }
      .asst-facet-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .asst-fchip {
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.1);
        color: rgba(255,255,255,.7);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px; cursor: pointer;
        transition: background .12s, border-color .12s, color .12s;
      }
      .asst-fchip:hover { border-color: rgba(255,77,77,.4); color: #fff; }
      .asst-fchip.active { background: rgba(255,77,77,.9); border-color: rgba(255,77,77,1); color: #fff; }

      /* ── Show / more / back buttons ─────────────────── */
      .asst-show-btn {
        width: 100%;
        background: rgba(255,77,77,.9); color: #fff;
        border: none; cursor: pointer;
        border-radius: 14px;
        padding: 14px; margin-top: 8px;
        font-size: 14px; font-weight: 700;
        font-family: inherit;
        transition: background .15s;
      }
      .asst-show-btn:hover { background: rgba(255,77,77,1); }
      .asst-show-btn:disabled { opacity: .4; cursor: not-allowed; }
      .asst-more-btn {
        width: 100%;
        background: rgba(255,77,77,.12);
        border: 1px solid rgba(255,77,77,.4);
        color: #ff7a7a;
        border-radius: 14px;
        padding: 11px; margin-top: 4px;
        font-size: 12px; font-weight: 600;
        font-family: inherit; cursor: pointer;
        transition: background .15s;
      }
      .asst-more-btn:hover { background: rgba(255,77,77,.2); }
      .asst-back-btn {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,.5);
        font-size: 12px; font-weight: 600;
        font-family: inherit;
        padding: 0 0 12px; margin: 0;
        display: inline-flex; align-items: center; gap: 5px;
      }
      .asst-back-btn:hover { color: #fff; }

      /* ── PSS browse list ────────────────────────────── */
      .asst-pss-search {
        width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 12px;
        padding: 10px 14px; margin-bottom: 4px;
        color: #fff; font-size: 13px; font-family: inherit;
        outline: none;
      }
      .asst-pss-search:focus { border-color: rgba(255,77,77,.55); }
      .asst-pss-count {
        font-size: 10px; font-weight: 600; letter-spacing: .06em;
        text-transform: uppercase; color: rgba(255,255,255,.4);
        margin: 12px 0 8px;
      }
      .asst-pss-row {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 4px;
        border-bottom: 1px solid rgba(255,255,255,.06);
        cursor: pointer;
        transition: background .12s;
      }
      .asst-pss-row:hover { background: rgba(255,255,255,.04); }
      .asst-pss-dot { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
      .asst-pss-info { flex: 1; min-width: 0; }
      .asst-pss-name {
        font-size: 13px; font-weight: 600; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .asst-pss-meta {
        font-size: 11px; color: rgba(255,255,255,.5);
        font-variant-numeric: tabular-nums; margin-top: 2px;
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
    // Focusing / clicking the top field behaves like pressing «Найти»:
    // it opens the picker panel (carrying over anything already typed).
    const openFromTop = () => {
      if (panelOpen) return;
      const q = topInput.value.trim();
      openPanel(q || undefined);
    };
    topInput.addEventListener('focus', openFromTop);
    topInput.addEventListener('mousedown', e => { e.preventDefault(); openFromTop(); });

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
      renderHome();
      setTimeout(() => document.getElementById('asst-panel-input').focus(), 300);
    }
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById('asst-backdrop').classList.remove('open');
    document.getElementById('asst-panel').classList.remove('open');
  }

  // ── Home (picker) ──────────────────────────────────────────
  function renderHome() {
    const body = document.getElementById('asst-panel-body');
    body.innerHTML = `
      <div class="asst-seg">
        <button class="asst-seg-btn ${homeTab === 'facets' ? 'active' : ''}" data-tab="facets">Подбор по параметрам</button>
        <button class="asst-seg-btn ${homeTab === 'pss' ? 'active' : ''}" data-tab="pss">Все PSS</button>
      </div>
      <div id="asst-home-content"></div>
    `;
    body.querySelectorAll('.asst-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => { homeTab = btn.dataset.tab; renderHome(); });
    });
    if (homeTab === 'facets') renderFacets();
    else renderPssList();
  }

  // ── Facet picker (like the app's «Подбор по параметрам») ────
  function chipHTML(label, active, key) {
    return `<button class="asst-fchip ${active ? 'active' : ''}" data-k="${escapeAttr(key)}">${escapeHtml(label)}</button>`;
  }
  function facetGroup(label, chips) {
    return `<div class="asst-facet-group"><div class="asst-facet-label">${escapeHtml(label)}</div><div class="asst-facet-chips">${chips}</div></div>`;
  }
  function toggleFacet(key) {
    if (key === 'diff-any') { facets.diff.clear(); return; }
    if (key === 'reg-any') { facets.regions.clear(); return; }
    if (key.startsWith('diff:')) { const k = key.slice(5); facets.diff.has(k) ? facets.diff.delete(k) : facets.diff.add(k); return; }
    if (key.startsWith('reg:')) { const r = key.slice(4); facets.regions.has(r) ? facets.regions.delete(r) : facets.regions.add(r); return; }
    if (key.startsWith('dist:')) { const i = +key.slice(5); facets.distIdx = facets.distIdx === i ? 0 : i; return; }
    if (key.startsWith('dur:')) { const i = +key.slice(4); facets.durIdx = facets.durIdx === i ? 0 : i; return; }
    if (key.startsWith('type:')) { const i = +key.slice(5); facets.typeIdx = facets.typeIdx === i ? 0 : i; return; }
  }

  function renderFacets() {
    const host = document.getElementById('asst-home-content');
    if (!host) return;
    if (!pssRoutes.length) {
      host.innerHTML = `<div class="asst-no-results">Загрузка маршрутов…</div>`;
      loadPssRoutes().then(() => { if (panelOpen && homeTab === 'facets') renderFacets(); });
      return;
    }
    const count = window.RouteMatcher.filterRoutes(buildFacetFilters(), buildCandidates()).length;

    const diffChips = [chipHTML('Любая', facets.diff.size === 0, 'diff-any')]
      .concat(DIFFS.map(([k, l]) => chipHTML(l, facets.diff.has(k), 'diff:' + k))).join('');
    const distChips = DIST_LABELS.map((l, i) => chipHTML(l, facets.distIdx === i, 'dist:' + i)).join('');
    const durChips  = DUR_LABELS.map((l, i) => chipHTML(l, facets.durIdx === i, 'dur:' + i)).join('');
    const typeChips = TYPE_LABELS.map((l, i) => chipHTML(l, facets.typeIdx === i, 'type:' + i)).join('');
    const regChips  = [chipHTML('Любой', facets.regions.size === 0, 'reg-any')]
      .concat(regionOptions().map(r => chipHTML(r, facets.regions.has(r), 'reg:' + r))).join('');

    host.innerHTML =
      facetGroup('Сложность', diffChips) +
      facetGroup('Расстояние', distChips) +
      facetGroup('Время в пути', durChips) +
      facetGroup('Тип', typeChips) +
      facetGroup('Регион', regChips) +
      `<button class="asst-show-btn" ${count ? '' : 'disabled'}>Показать маршруты · ${count}</button>` +
      `<div class="asst-suggest-label" style="margin-top:22px;">Или опиши словами</div>
       <div class="asst-suggest-chips">${SUGGESTIONS.map(sg => `<button class="asst-chip" data-q="${escapeAttr(sg)}">${escapeHtml(sg)}</button>`).join('')}</div>`;

    host.querySelectorAll('.asst-fchip').forEach(chip => {
      chip.addEventListener('click', () => { toggleFacet(chip.dataset.k); renderFacets(); });
    });
    const showBtn = host.querySelector('.asst-show-btn');
    if (showBtn) showBtn.addEventListener('click', runFacetSearch);
    host.querySelectorAll('.asst-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('asst-panel-input').value = btn.dataset.q;
        runSearch(btn.dataset.q);
      });
    });
  }

  function facetReasons(r) {
    const out = [];
    const lbl = (DIFFS.find(d => d[0] === window.RouteMatcher.canonDiff(r.difficulty)) || [])[1];
    if (lbl) out.push(lbl);
    if (r.distance_km) out.push((+r.distance_km).toFixed(1) + ' км');
    if (r.region) out.push(r.region);
    return out.slice(0, 3);
  }

  function runFacetSearch() {
    const filtered = window.RouteMatcher.filterRoutes(buildFacetFilters(), buildCandidates());
    const results = filtered.map(r => ({ route: r, reasons: facetReasons(r) }));
    resultsVisible = 5;
    renderResults(results, { from: 'facets' });
  }

  // ── Browse all PSS routes ──────────────────────────────────
  function pssRowHTML(r) {
    const color = DIFF_COLOR[window.RouteMatcher.canonDiff(r.difficulty)] || '#888';
    const meta = [];
    if (r.distance_km) meta.push((+r.distance_km).toFixed(1) + ' км');
    if (r.ascent_m) meta.push('↑' + Math.round(r.ascent_m) + ' м');
    if (r.duration_h) meta.push('⏱' + (+r.duration_h).toFixed(1) + ' ч');
    if (r.region) meta.push(r.region);
    return `<div class="asst-pss-row" data-slug="${escapeAttr(r.slug)}">
      <div class="asst-pss-dot" style="background:${color}"></div>
      <div class="asst-pss-info">
        <div class="asst-pss-name">${escapeHtml(r.name)}</div>
        <div class="asst-pss-meta">${escapeHtml(meta.join('  ·  '))}</div>
      </div>
    </div>`;
  }
  function wirePssRows(container) {
    if (!container) return;
    container.querySelectorAll('.asst-pss-row').forEach(row => {
      row.addEventListener('click', () => {
        const slug = row.dataset.slug;
        if (slug && typeof window.showPSSRoute === 'function') { closePanel(); window.showPSSRoute(slug); }
      });
    });
  }
  function pssFilteredList() {
    const q = window.RouteMatcher.norm(pssQuery);
    return q ? pssRoutes.filter(r => window.RouteMatcher.norm(r.name).indexOf(q) !== -1) : pssRoutes;
  }
  function renderPssList() {
    const host = document.getElementById('asst-home-content');
    if (!host) return;
    if (!pssRoutes.length) {
      host.innerHTML = `<div class="asst-no-results">Загрузка маршрутов…</div>`;
      loadPssRoutes().then(() => { if (panelOpen && homeTab === 'pss') renderPssList(); });
      return;
    }
    const list = pssFilteredList();
    host.innerHTML = `
      <input class="asst-pss-search" type="text" placeholder="Поиск по PSS маршрутам" value="${escapeAttr(pssQuery)}">
      <div class="asst-pss-count">${list.length} ${routeWord(list.length)}</div>
      <div id="asst-pss-rows">${list.map(pssRowHTML).join('') || '<div class="asst-no-results">Ничего не найдено</div>'}</div>
    `;
    const search = host.querySelector('.asst-pss-search');
    search.addEventListener('input', () => {
      pssQuery = search.value;
      const list2 = pssFilteredList();
      host.querySelector('.asst-pss-count').textContent = `${list2.length} ${routeWord(list2.length)}`;
      const rowsEl = host.querySelector('#asst-pss-rows');
      rowsEl.innerHTML = list2.map(pssRowHTML).join('') || '<div class="asst-no-results">Ничего не найдено</div>';
      wirePssRows(rowsEl);
    });
    wirePssRows(host.querySelector('#asst-pss-rows'));
  }

  function routeWord(n) {
    const m = n % 10, h = n % 100;
    if (m === 1 && h !== 11) return 'маршрут';
    if (m >= 2 && m <= 4 && !(h >= 12 && h <= 14)) return 'маршрута';
    return 'маршрутов';
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
        const { results } = window.RouteMatcher.matchRoutes(query, candidates, { limit: 30 });
        resultsVisible = 5;
        renderResults(results, { from: 'text' });
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
  function wireBack(opts) {
    const b = document.querySelector('#asst-panel-body .asst-back-btn');
    if (b) b.addEventListener('click', () => {
      homeTab = opts.from === 'facets' ? 'facets' : homeTab;
      renderHome();
    });
  }

  function renderResults(results, opts) {
    opts = opts || {};
    const body = document.getElementById('asst-panel-body');
    const backLabel = opts.from === 'facets' ? 'к параметрам' : 'назад';
    const backHTML = `<button class="asst-back-btn">← ${backLabel}</button>`;

    if (!results || results.length === 0) {
      body.innerHTML = backHTML + `<div class="asst-no-results">
        <div class="asst-no-results-icon">🥾</div>
        Ничего не нашлось.<br>
        <span style="font-size:11px; opacity:.7;">Измени параметры или ослабь ограничения</span>
      </div>`;
      wireBack(opts);
      return;
    }

    const shown = results.slice(0, resultsVisible);
    const cards = shown.map((r, i) => renderResultCard(r, i)).join('');
    const remaining = results.length - resultsVisible;
    const moreHTML = remaining > 0
      ? `<button class="asst-more-btn">Ещё ${Math.min(5, remaining)} · осталось ${remaining}</button>`
      : '';

    body.innerHTML = backHTML +
      `<div class="asst-suggest-label">Подобрано · ${results.length}</div>` +
      cards + moreHTML;

    body.querySelectorAll('.asst-result').forEach((el, i) => {
      el.addEventListener('click', () => handleResultClick(shown[i].route));
    });
    const moreBtn = body.querySelector('.asst-more-btn');
    if (moreBtn) moreBtn.addEventListener('click', () => { resultsVisible += 5; renderResults(results, opts); });
    wireBack(opts);
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
    if (pssLoad) return pssLoad;
    pssLoad = fetch('routes_index.json')
      .then(r => r.ok ? r.json() : [])
      .then(data => { pssRoutes = Array.isArray(data) ? data : []; return pssRoutes; })
      .catch(() => { pssRoutes = []; return pssRoutes; });
    return pssLoad;
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
