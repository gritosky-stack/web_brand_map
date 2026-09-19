/* ── Метки старта, финиша и высшей точки ─────────────────────────────────────
 *
 * Бейджи рисуются в картинку на canvas и кладутся на карту символьным слоем,
 * а не DOM-метками (`mapboxgl.Marker`).
 *
 * ⚠️ DOM-метка ставится поверх карты отдельно от неё и высоту на рельефе
 * узнаёт по-своему — не так, как линия маршрута, которая ложится прямо на
 * 3D-поверхность. На наклонённой камере метки старта и финиша висели в
 * десятках пикселей от концов тропы, и тем дальше, чем дальше отъехать
 * (фидбэк 2026-09-18, 2026-09-19). Символьный слой ставится на рельеф тем же
 * механизмом, что и линия, и разъехаться с ней не может.
 */
(function (root) {
    'use strict';

    const SOURCE = 'route-marks';
    const LAYER = 'route-marks-layer';
    // Картинки рисуем с запасом по плотности: ретина и приближение браузера
    const PR = 2;
    const FONT = '700 9px system-ui, -apple-system, "Segoe UI", sans-serif';

    // Расстояние от низа картинки до центра точки: на столько сдвигаем
    // символ вниз, чтобы на координате стояла именно точка, а не край свечения
    const DOT_BOTTOM = 10;

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /** Текст с разрядкой: `letterSpacing` у canvas есть не во всех браузерах */
    function spacedWidth(ctx, text, spacing) {
        let w = 0;
        for (const ch of text) w += ctx.measureText(ch).width + spacing;
        return w - spacing;
    }
    function drawSpaced(ctx, text, x, y, spacing) {
        for (const ch of text) {
            ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width + spacing;
        }
    }

    function drawStartFlag(ctx, x, y) {
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x + 0.5, y + 0.5, 1.5, 13);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + 11, y + 1); ctx.lineTo(x + 8.5, y + 4.5);
        ctx.lineTo(x + 11, y + 8); ctx.lineTo(x + 2, y + 8); ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    function drawFinishFlag(ctx, x, y) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x + 0.5, y + 0.5, 1.5, 13);
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                ctx.fillStyle = (row + col) % 2 ? 'rgba(255,255,255,.85)' : '#ef4444';
                ctx.fillRect(x + 2 + col * 3, y + 1 + row * 3, 3, 3);
            }
        }
    }

    function drawPeakIcon(ctx, cx, y) {
        const x = cx - 8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 1.5); ctx.lineTo(x + 14.5, y + 12); ctx.lineTo(x + 1.5, y + 12); ctx.closePath();
        ctx.fillStyle = 'rgba(255,140,0,0.15)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#FF8C00';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 5.5, y + 7.5); ctx.lineTo(x + 8, y + 5); ctx.lineTo(x + 10.5, y + 7.5);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.stroke();
    }

    /**
     * Бейдж, ножка и точка одной картинкой.
     * kind: 'start' | 'finish' | 'loop' | 'peak'
     */
    function makeImage(kind) {
        const spec = {
            start:  { label: 'СТАРТ', color: '#22c55e', border: 'rgba(34,197,94,0.6)', stem: 22, icons: [drawStartFlag] },
            finish: { label: 'ФИНИШ', color: '#ef4444', border: 'rgba(239,68,68,0.6)', stem: 22, icons: [drawFinishFlag] },
            loop:   { label: 'START / FINISH', color: '#ffffff', border: 'rgba(255,255,255,0.25)', stem: 22,
                      icons: [drawStartFlag, drawFinishFlag], spacing: 0.72 },
            peak:   { label: 'MAX', color: '#FF8C00', border: 'rgba(255,140,0,0.65)', stem: 26, vertical: true }
        }[kind];

        const measure = document.createElement('canvas').getContext('2d');
        const labelFont = spec.vertical ? '700 7px system-ui, -apple-system, "Segoe UI", sans-serif' : FONT;
        measure.font = labelFont;
        const spacing = spec.vertical ? 0.84 : (spec.spacing || 0.9);
        const textW = spacedWidth(measure, spec.label, spacing);

        let badgeW, badgeH;
        if (spec.vertical) {
            badgeW = Math.max(16, textW) + 14;
            badgeH = 5 + 13 + 2 + 7 + 5;
        } else {
            const iconsW = spec.icons.length * 14 + (spec.icons.length - 1) * 5;
            badgeW = 8 + iconsW + 5 + textW + 8;
            badgeH = 24;
        }
        badgeW = Math.ceil(badgeW);

        const margin = 12;                       // под тень бейджа
        const width = badgeW + margin * 2;
        const dotR = spec.vertical ? 7 : 6.5;    // точка вместе с обводкой
        const height = margin + badgeH + spec.stem + dotR + DOT_BOTTOM - 1;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * PR);
        canvas.height = Math.ceil(height * PR);
        const ctx = canvas.getContext('2d');
        ctx.scale(PR, PR);
        const cx = width / 2;
        const bx = margin, by = margin;

        // Бейдж
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 2;
        roundRect(ctx, bx, by, badgeW, badgeH, spec.vertical ? 7 : 6);
        ctx.fillStyle = 'rgba(9,9,11,0.9)';
        ctx.fill();
        ctx.restore();
        roundRect(ctx, bx + 0.5, by + 0.5, badgeW - 1, badgeH - 1, spec.vertical ? 6.5 : 5.5);
        ctx.lineWidth = 1;
        ctx.strokeStyle = spec.border;
        ctx.stroke();

        ctx.font = labelFont;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = spec.color;
        if (spec.vertical) {
            drawPeakIcon(ctx, cx, by + 5);
            ctx.fillStyle = spec.color;
            drawSpaced(ctx, spec.label, cx - textW / 2, by + 5 + 13 + 2 + 3.5, spacing);
        } else {
            let x = bx + 8;
            spec.icons.forEach(draw => { draw(ctx, x, by + 5); x += 19; });
            ctx.fillStyle = spec.color;
            drawSpaced(ctx, spec.label, x, by + badgeH / 2 + 0.5, spacing);
        }

        // Ножка — от бейджа к точке, растворяется книзу
        const stemTop = by + badgeH;
        const grad = ctx.createLinearGradient(0, stemTop, 0, stemTop + spec.stem);
        grad.addColorStop(0, hexA(spec.color, 0.72));
        grad.addColorStop(1, hexA(spec.color, 0.03));
        ctx.fillStyle = grad;
        ctx.fillRect(cx - 0.75, stemTop, 1.5, spec.stem);

        // Точка с белой обводкой и свечением
        const dotY = height - DOT_BOTTOM;
        ctx.save();
        ctx.shadowColor = hexA(spec.color, 0.85);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, dotY, dotR - 2, 0, Math.PI * 2);
        ctx.fillStyle = spec.color;
        ctx.fill();

        return {
            image: ctx.getImageData(0, 0, canvas.width, canvas.height),
            // Кликабельная часть — только бейдж: высота его верхней части
            badgeBottom: height - (margin + badgeH)
        };
    }

    function hexA(color, alpha) {
        if (color[0] !== '#') return color;
        const n = parseInt(color.slice(1), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }

    const RouteMarks = {
        map: null,
        hidden: false,
        features: [],
        peak: null,

        _ensure() {
            const map = this.map;
            if (!map) return false;
            try { if (!map.getStyle()) return false; } catch (e) { return false; }
            ['start', 'finish', 'loop', 'peak'].forEach(kind => {
                const name = `route-mark-${kind}`;
                if (!map.hasImage(name)) map.addImage(name, makeImage(kind).image, { pixelRatio: PR });
            });
            if (!map.getSource(SOURCE)) {
                map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            if (!map.getLayer(LAYER)) {
                map.addLayer({
                    id: LAYER, type: 'symbol', source: SOURCE,
                    layout: {
                        'icon-image': ['concat', 'route-mark-', ['get', 'kind']],
                        'icon-anchor': 'bottom',
                        // Картинка кончается ниже точки — сдвигаем, чтобы на
                        // координате стоял центр точки
                        'icon-offset': [0, DOT_BOTTOM],
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        'icon-pitch-alignment': 'viewport',
                        'icon-rotation-alignment': 'viewport',
                        // Вершина поверх старта/финиша, если они рядом
                        'symbol-sort-key': ['match', ['get', 'kind'], 'peak', 2, 1],
                        'symbol-z-order': 'source'
                    }
                });
                map.on('click', LAYER, e => this._onClick(e));
                map.on('mouseenter', LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', LAYER, () => { map.getCanvas().style.cursor = ''; });
            }
            return true;
        },

        _push() {
            if (!this._ensure()) return;
            this.map.getSource(SOURCE).setData({ type: 'FeatureCollection', features: this.features });
            this.map.setLayoutProperty(LAYER, 'visibility', this.hidden ? 'none' : 'visible');
        },

        _onClick(e) {
            const f = e.features && e.features[0];
            if (!f || f.properties.kind !== 'peak' || !this.peak) return;
            this.map.flyTo({ center: this.peak, zoom: 16, pitch: 75,
                             bearing: this.map.getBearing() + 45, speed: 1.5 });
        },

        /** Старт и финиш; кольцевой маршрут — одна метка «Start / Finish» */
        setEnds(coordinates) {
            const start = coordinates[0];
            const finish = coordinates[coordinates.length - 1];
            const point = (kind, c) => ({ type: 'Feature', properties: { kind },
                                          geometry: { type: 'Point', coordinates: c } });
            const loop = root.GradeColor.meters(start, finish) < 400;
            this.features = this.features.filter(f => f.properties.kind === 'peak');
            if (loop) this.features.push(point('loop', start));
            else this.features.push(point('start', start), point('finish', finish));
            this._push();
        },

        setPeak(coord) {
            this.peak = coord || null;
            this.features = this.features.filter(f => f.properties.kind !== 'peak');
            if (coord) this.features.push({ type: 'Feature', properties: { kind: 'peak' },
                                            geometry: { type: 'Point', coordinates: coord } });
            this._push();
        },

        clear() {
            this.features = [];
            this.peak = null;
            if (this.map && this.map.getSource && this.map.getSource(SOURCE)) this._push();
        },

        setHidden(hidden) {
            this.hidden = !!hidden;
            if (this.map && this.map.getLayer(LAYER)) {
                this.map.setLayoutProperty(LAYER, 'visibility', this.hidden ? 'none' : 'visible');
            }
        }
    };

    root.RouteMarks = RouteMarks;
})(typeof globalThis !== 'undefined' ? globalThis : window);
