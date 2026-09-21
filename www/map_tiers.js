/**
 * Ярусы карты — порт `Views/MapboxMapView+Tiers.swift` (см. `hikingmap/CLAUDE.md`,
 * «Ярусы карты: что видно в первую очередь»).
 *
 * Три роли, а не полтора десятка слоёв: **то, что открыли** — **контекст,
 * включённый тумблером** — **фон**.
 *
 * Правило, которое заменяет таблицу чисел: **ореол есть ровно у одного
 * объекта на карте**, у открытого маршрута. Увидел второй — ярусы сломались.
 * Оно проверяется глазами за секунду и потому переживает правки лучше.
 *
 * ⚠️ Приглушение второго и третьего ярусов действует, **только пока маршрут
 * открыт**. Закрыли карточку — всё возвращается в полную силу: карта не
 * должна выглядеть выцветшей сама по себе.
 *
 * ⚠️ В отличие от приложения, здесь тумблеры слоёв не пишут в прозрачность:
 * на сайте выключенный слой либо снимается с карты, либо гасится
 * `visibility` (`extra_layers.js`). Поэтому ярусам не нужна оглядка на
 * состояние тумблера — достаточно проверить, что слой на карте есть.
 */
(function () {
    'use strict';

    // idle — когда маршрут не открыт, open — пока открыт.
    //
    // ⚠️ Свечение ПСС погашено **всегда** (0 в обоих состояниях), а не только
    // при открытом маршруте: это и был тот самый второй ореол. Слой оставлен
    // на карте, чтобы правка была обратима одним числом.
    //
    // ⚠️ Растры почти не приглушаются. В приложении была версия с 0.30 и
    // обесцвеченным хитмапом — «его вообще не видно почти, это не дело»
    // (фидбэк 2026-08-31). Оба растра включают тумблером ровно затем, чтобы
    // на них смотреть; работу «где открытый маршрут» делает ореол с обводкой.
    const TIERS = [
        { id: 'pss-trails-casing',        prop: 'line-opacity',   idle: 0.65, open: 0.24 },
        { id: 'pss-trails-glow',          prop: 'line-opacity',   idle: 0,    open: 0    },
        { id: 'pss-trails-line',          prop: 'line-opacity',   idle: 0.85, open: 0.38 },
        { id: 'osm-trails',               prop: 'line-opacity',   idle: 0.9,  open: 0.32 },
        // Линии обзора — по статусу маршрута (`STATUS_COLOR` в script.js).
        // Анонс приглушается слабее: на него и смотрят
        { id: 'overview-lines-done',      prop: 'line-opacity',   idle: 0.85, open: 0.32 },
        { id: 'overview-lines-idle',      prop: 'line-opacity',   idle: 0.85, open: 0.32 },
        { id: 'overview-lines-planned',   prop: 'line-opacity',   idle: 0.9,  open: 0.42 },
        // Железная дорога включена по умолчанию, поэтому спорит с маршрутом
        // чаще прочих; станции (символьный слой) не трогаем — это подписи
        { id: 'railway-line',             prop: 'line-opacity',   idle: 1,    open: 0.35 },
        { id: 'railway-hatch',            prop: 'line-opacity',   idle: 1,    open: 0.35 },
        // Точки маршрутов на сайте — символьный слой с пульсирующим значком,
        // а не круги, как в приложении: гасим значок целиком
        { id: 'route-markers-layer',      prop: 'icon-opacity',   idle: 1,    open: 0.42 },
        { id: 'heatmap-layer',            prop: 'raster-opacity', idle: 0.75, open: 0.62 },
        { id: 'slope-layer',              prop: 'raster-opacity', idle: 0.85, open: 0.85 }
    ];

    let pssOpen = false;

    function hasOpenRoute() {
        const curated = typeof currentViewedRoute !== 'undefined' && !!currentViewedRoute;
        return curated || pssOpen;
    }

    /**
     * Погасить или вернуть контекст и фон. Зовётся при смене открытого
     * маршрута и после каждой пересборки слоёв (`restack` в extra_layers.js).
     */
    function refresh() {
        const m = window.map;
        if (!m || !m.isStyleLoaded || !m.getLayer) return;
        const open = hasOpenRoute();
        // Множитель «Сравнения карт» (`map_slots.js`): крутизна и хитмап могут
        // стоять вторым слотом, и тогда их прозрачность — это ярус, умноженный
        // на ползунок. Собираем число в одном месте, иначе ползунок и ярусы
        // затирали бы друг друга.
        const slot = id => (window.MapSlots ? MapSlots.factorForLayer(id) : 1);
        for (const tier of TIERS) {
            if (!m.getLayer(tier.id)) continue;
            try {
                m.setPaintProperty(tier.id, tier.prop, (open ? tier.open : tier.idle) * slot(tier.id));
            } catch (e) {
                // Слой мог уехать со стилем между проверкой и записью
            }
        }
    }

    /** Открытый маршрут ПСС — тоже первый ярус (`pss_layer.js`). */
    function setPSSOpen(value) {
        const next = !!value;
        if (pssOpen === next) return;
        pssOpen = next;
        refresh();
    }

    window.MapTiers = { refresh, setPSSOpen, hasOpenRoute };
})();
