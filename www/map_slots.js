/**
 * Сравнение карт: два слота и ползунок между ними.
 *
 * В слот втыкается одна из растровых карт сайта (спутник, топооснова,
 * гравюра, крутизна, хитмап). Слой 1 лежит снизу и всегда во всю силу,
 * слой 2 — сверху и проявляется ползунком: слева видно только первый,
 * справа — только второй, посередине одно просвечивает сквозь другое.
 *
 * Почему именно прозрачность, а не «шторка» с вертикальной линией: в
 * Mapbox GL JS растр нельзя обрезать по экрану, для шторки нужна вторая
 * карта поверх с `clip-path`, и на наклонённой камере с рельефом половинки
 * разъезжаются. Прозрачность же работает при любом наклоне и повороте —
 * это ровно то, что уже делает ползунок гравюры, только для любой пары.
 *
 * Слои остаются обычными слоями `extra_layers.js`: слот их включает
 * тумблером (галочка в «Слоях» ставится сама) и просит `restack()` положить
 * первый слот под второй. Мы правим только **множитель** прозрачности —
 * `factorFor()` спрашивают `extra_layers.js` (топо и гравюра) и
 * `map_tiers.js` (крутизна и хитмап, у них своя приглушёнка под открытым
 * маршрутом). Так ползунок и ярусы не дерутся за одно число.
 */
(function () {
    'use strict';

    // Что можно воткнуть в слот. У «спутника» своих слоёв нет — это сама
    // основа стиля, то есть «ничего сверху»
    const MAPS = {
        sat:     { name: 'Спутник',         layers: [] },
        topo:    { name: '⛰ Топооснова',    layers: ['topo-layer'] },
        histmap: { name: '🗺 Историческая',  layers: ['histmap-backdrop', 'histmap-layer', 'histmap-edge'] },
        slope:   { name: '📐 Крутизна',      layers: ['slope-layer'] },
        heat:    { name: '🔥 Хитмап троп',   layers: ['heatmap-layer'] }
    };
    const SLOT_A = ['sat', 'topo', 'histmap', 'slope', 'heat'];
    // Снизу второму слоту делать нечего: спутник и так под всеми
    const SLOT_B = ['topo', 'histmap', 'slope', 'heat'];

    const LS = 'tw-compare';

    let open = false;
    let a = 'sat', b = 'topo';
    let mix = 0.5;
    // Слои, которые включили мы, а не человек тумблером: их же и гасим,
    // когда слот сменился или сравнение закрыли. Что было включено до нас —
    // не трогаем
    const auto = new Set();
    // Пока слот сам двигает тумблеры, отклик тумблеров назад не слушаем
    let syncing = false;

    // ── Что спрашивают другие ───────────────────────────────────────────────

    /** Множитель прозрачности набора: полный, кроме второго слота */
    function factorFor(key) {
        return open && key === b ? mix : 1;
    }

    /** То же, но по id слоя — для `map_tiers.js` */
    function factorForLayer(id) {
        if (!open) return 1;
        return MAPS[b] && MAPS[b].layers.indexOf(id) >= 0 ? mix : 1;
    }

    /**
     * Порядок растров снизу вверх (`restack` в extra_layers.js). Двигаем
     * минимально: первый слот должен оказаться под вторым, остальное
     * остаётся на своих местах.
     */
    function orderKeys(def) {
        if (!open || a === 'sat' || a === b) return def;
        const ia = def.indexOf(a), ib = def.indexOf(b);
        if (ia < 0 || ib < 0 || ia < ib) return def;
        const out = def.filter(k => k !== a);
        out.splice(out.indexOf(b), 0, a);
        return out;
    }

    /** Тумблер в «Слоях» дёрнули руками — слот с погасшим слоем пустеет */
    function onLayerToggled(key, value) {
        if (syncing || value) return;
        auto.delete(key);
        if (!open) return;
        if (b === key) { b = freeSlotB(key) || b; apply(); syncUI(); }
        else if (a === key) { a = 'sat'; apply(); syncUI(); }
    }

    // ── Слои под слотами ────────────────────────────────────────────────────

    /** Гравюра открыта не всем (`premium.js`) — в слот её пускаем так же */
    const blocked = key => key === 'histmap' && !!(window.Premium && !Premium.allowed());

    /**
     * Чем заменить второй слот, когда его карту забрали или она закрыта.
     * ⚠️ Закрытую сюда подставлять нельзя: в списке будет одно, а на карте
     * ничего — слот молча окажется пустым.
     */
    const freeSlotB = (taken) => SLOT_B.find(k => k !== a && k !== taken && !blocked(k));

    function setLayer(key, want) {
        if (!key || key === 'sat') return false;
        if (want && blocked(key)) return false;
        syncing = true;
        try {
            if (key === 'heat') {
                const cb = document.getElementById('layer-heat');
                if (cb) cb.checked = want;
                if (window.toggleHeatmap) toggleHeatmap(want);
                if (window.syncLayersBtn) syncLayersBtn();
            } else {
                const cb = document.getElementById('layer-' + key);
                if (cb) cb.checked = want;
                if (window.ExtraLayers) ExtraLayers.set(key, want);
            }
        } finally { syncing = false; }
        return true;
    }

    const isOnMap = key => key === 'sat' || !key ||
        (key === 'heat' ? !!(window.map && map.getLayer('heatmap-layer'))
                        : !!(window.ExtraLayers && ExtraLayers.isOn(key)));

    /** Слой ушёл из слота: гасим, только если включали его мы */
    function release(key) {
        if (!key || key === 'sat' || key === a || key === b) return;
        if (!auto.has(key)) return;
        auto.delete(key);
        setLayer(key, false);
    }

    /** Включить то, что стоит в слотах, разложить по порядку и раздать силу */
    function apply() {
        [a, b].forEach(key => {
            if (key === 'sat' || isOnMap(key)) return;
            if (setLayer(key, true)) auto.add(key);
        });
        redraw();
    }

    /** Перечитать прозрачности и порядок — своё число собирает каждый модуль */
    function redraw() {
        if (window.ExtraLayers) { ExtraLayers.restack(); ExtraLayers.refreshAlpha(); }
        else if (window.MapTiers) MapTiers.refresh();
    }

    // ── Плашка ──────────────────────────────────────────────────────────────

    function fillSelect(el, keys, value) {
        if (!el) return;
        el.innerHTML = '';
        for (const key of keys) {
            const o = document.createElement('option');
            o.value = key;
            o.textContent = MAPS[key].name;
            el.appendChild(o);
        }
        el.value = value;
    }

    function syncUI() {
        const bar = document.getElementById('compare-bar');
        if (!bar) return;
        bar.classList.toggle('hidden', !open);
        // На телефоне плашка встаёт на место столбика кнопок — он уезжает
        // вверх по этому классу (стили рядом с `#compare-bar`)
        document.body.classList.toggle('tw-compare', open);
        const cb = document.getElementById('layer-compare');
        if (cb) cb.checked = open;
        fillSelect(document.getElementById('cmp-slot-a'), SLOT_A, a);
        fillSelect(document.getElementById('cmp-slot-b'), SLOT_B, b);
        const pct = Math.round(mix * 100);
        const range = document.getElementById('cmp-mix');
        if (range && +range.value !== pct) range.value = pct;
        // Спутник — это сама основа стиля, сверху его не положить
        const sw = document.getElementById('cmp-swap');
        if (sw) sw.disabled = a === 'sat';
        const value = document.getElementById('cmp-mix-value');
        if (value) value.textContent = `${pct}%`;
        save();
    }

    function save() {
        try { localStorage.setItem(LS, JSON.stringify({ a, b, mix })); } catch (e) {}
    }

    function load() {
        try {
            const v = JSON.parse(localStorage.getItem(LS) || 'null');
            if (!v) return;
            if (SLOT_A.indexOf(v.a) >= 0) a = v.a;
            if (SLOT_B.indexOf(v.b) >= 0) b = v.b;
            if (typeof v.mix === 'number') mix = Math.min(1, Math.max(0, v.mix));
        } catch (e) {}
        // Закрытую карту (`blocked`) здесь не проверяем: вход через Google
        // доезжает позже, и сохранённый выбор потерялся бы на ровном месте.
        // Проверка стоит там, где слот и правда включают, — в `setOpen`
        if (a === b) a = 'sat';
    }

    function setOpen(value) {
        const next = !!value;
        if (open === next) return;
        open = next;
        if (open) {
            if (blocked(a)) a = 'sat';
            if (blocked(b)) b = freeSlotB() || 'topo';
            apply();
        } else {
            // Закрыли — то, что включили ради сравнения, гаснет; что было
            // включено до нас, остаётся и возвращается в полную силу
            const mine = Array.from(auto);
            auto.clear();
            mine.forEach(key => setLayer(key, false));
            redraw();
        }
        syncUI();
    }

    function pick(slot, key) {
        if (!MAPS[key]) return;
        if (blocked(key)) {
            // Выбор не проходит — показываем ту же плашку, что и тумблер,
            // и возвращаем список к тому, что на карте
            if (window.Premium) Premium.require(key);
            syncUI();
            return;
        }
        const other = slot === 'a' ? b : a;
        const prev = slot === 'a' ? a : b;
        if (key === other && key !== 'sat') {
            // Ту же карту в оба слота не воткнуть — меняем их местами
            if (slot === 'a') { a = key; b = prev === 'sat' ? (freeSlotB(key) || b) : prev; }
            else { b = key; a = prev; }
        } else if (slot === 'a') a = key;
        else b = key;
        release(prev);
        apply();
        syncUI();
    }

    function swap() {
        if (a === 'sat') return;          // спутник сверху не бывает
        const t = a; a = b; b = t;
        apply();
        syncUI();
    }

    function setMix(value) {
        mix = Math.min(1, Math.max(0, value));
        // Порядок слоёв ползунок не меняет — только прозрачность
        if (window.ExtraLayers) ExtraLayers.refreshAlpha();
        else if (window.MapTiers) MapTiers.refresh();
        const el = document.getElementById('cmp-mix-value');
        if (el) el.textContent = `${Math.round(mix * 100)}%`;
        save();
    }

    function init() {
        load();
        const cb = document.getElementById('layer-compare');
        if (cb) cb.addEventListener('change', () => setOpen(cb.checked));
        const close = document.getElementById('cmp-close');
        if (close) close.addEventListener('click', () => setOpen(false));
        const selA = document.getElementById('cmp-slot-a');
        if (selA) selA.addEventListener('change', () => pick('a', selA.value));
        const selB = document.getElementById('cmp-slot-b');
        if (selB) selB.addEventListener('change', () => pick('b', selB.value));
        const sw = document.getElementById('cmp-swap');
        if (sw) sw.addEventListener('click', swap);
        const range = document.getElementById('cmp-mix');
        if (range) range.addEventListener('input', () => setMix(range.value / 100));
        syncUI();
    }

    window.MapSlots = { factorFor, factorForLayer, orderKeys, onLayerToggled,
                        setOpen, isOpen: () => open };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
