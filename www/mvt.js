/**
 * Минимальный разбор векторного тайла Mapbox (MVT) — только линии и только
 * нужные свойства.
 *
 * Зачем свой, когда карта и так читает тайлы: `querySourceFeatures` отдаёт
 * лишь то, что карта **уже загрузила для текущего зума**, а троп в тайлах
 * Mapbox Streets нет ниже z13. Рисуют же маршрут и с z11–12, где троп на
 * экране нет вовсе. Поэтому тайлы z13 для видимой области мы качаем сами
 * (`mapbox.mapbox-streets-v8/{z}/{x}/{y}.mvt`) и разбираем здесь.
 *
 * Библиотеку (`@mapbox/vector-tile` + `pbf`) не берём: нужен один тип
 * геометрии и пара полей, а формат простой и стабильный —
 * https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 *
 * Работает и в Node (для проверок), и в браузере.
 */
(function (root) {
    'use strict';

    /** Чтение protobuf: варинты, длины, пропуск неизвестных полей */
    class Reader {
        constructor(buf, end) {
            this.buf = buf;
            this.pos = 0;
            this.end = end == null ? buf.length : end;
        }
        varint() {
            let result = 0, shift = 0, b;
            do {
                b = this.buf[this.pos++];
                result += (b & 0x7f) * Math.pow(2, shift);
                shift += 7;
            } while (b >= 0x80);
            return result;
        }
        // Знаковые в MVT приходят зигзагом: 0,-1,1,-2 → 0,1,2,3
        zigzag() { const n = this.varint(); return (n >>> 1) ^ -(n & 1); }
        bytes() {
            const len = this.varint(), start = this.pos;
            this.pos += len;
            return [start, start + len];
        }
        string() {
            const [a, b] = this.bytes();
            let s = '';
            for (let i = a; i < b; i++) {
                const c = this.buf[i];
                // UTF-8: имена дорог бывают кириллицей
                if (c < 0x80) s += String.fromCharCode(c);
                else if (c < 0xe0) { s += String.fromCharCode(((c & 0x1f) << 6) | (this.buf[++i] & 0x3f)); }
                else if (c < 0xf0) {
                    s += String.fromCharCode(((c & 0x0f) << 12) | ((this.buf[++i] & 0x3f) << 6) | (this.buf[++i] & 0x3f));
                } else { i += 3; s += '?'; }
            }
            return s;
        }
        double() {
            const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
            this.pos += 8;
            return v;
        }
        float() {
            const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true);
            this.pos += 4;
            return v;
        }
        skip(tag) {
            const type = tag & 7;
            if (type === 0) this.varint();
            else if (type === 1) this.pos += 8;
            else if (type === 2) this.pos += this.varint();
            else if (type === 5) this.pos += 4;
            else throw new Error('MVT: неизвестный тип поля ' + type);
        }
    }

    function readValue(r, end) {
        let value = null;
        while (r.pos < end) {
            const tag = r.varint();
            switch (tag >> 3) {
                case 1: value = r.string(); break;
                case 2: value = r.float(); break;
                case 3: value = r.double(); break;
                case 4: case 5: value = r.varint(); break;
                case 6: value = r.zigzag(); break;
                case 7: value = !!r.varint(); break;
                default: r.skip(tag);
            }
        }
        return value;
    }

    /**
     * Линии слоя `layerName` из тайла, сразу в градусах.
     * `wanted` — какие свойства оставить (Set), `keep` — фильтр по свойствам.
     */
    function lines(buffer, z, x, y, layerName, wanted, keep) {
        const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const out = [];
        const top = new Reader(data);
        while (top.pos < top.end) {
            const tag = top.varint();
            if (tag >> 3 !== 3) { top.skip(tag); continue; }      // 3 = layer
            const [start, end] = top.bytes();
            readLayer(data, start, end, z, x, y, layerName, wanted, keep, out);
        }
        return out;
    }

    function readLayer(data, start, end, z, x, y, layerName, wanted, keep, out) {
        const r = new Reader(data, end);
        r.pos = start;
        let name = null, extent = 4096;
        const keys = [], values = [], features = [];
        while (r.pos < end) {
            const tag = r.varint();
            switch (tag >> 3) {
                case 1: name = r.string(); break;
                case 2: features.push(r.bytes()); break;
                case 3: keys.push(r.string()); break;
                case 4: { const [a, b] = r.bytes(); const vr = new Reader(data, b); vr.pos = a; values.push(readValue(vr, b)); break; }
                case 5: extent = r.varint(); break;
                default: r.skip(tag);
            }
        }
        if (name !== layerName) return;

        const size = extent * Math.pow(2, z);
        const x0 = extent * x, y0 = extent * y;
        for (const [fs, fe] of features) {
            const fr = new Reader(data, fe);
            fr.pos = fs;
            let type = 0, tags = null, geom = null;
            while (fr.pos < fe) {
                const tag = fr.varint();
                switch (tag >> 3) {
                    case 2: tags = fr.bytes(); break;
                    case 3: type = fr.varint(); break;
                    case 4: geom = fr.bytes(); break;
                    default: fr.skip(tag);
                }
            }
            if (type !== 2 || !geom) continue;                    // 2 = LineString

            const props = {};
            if (tags) {
                const tr = new Reader(data, tags[1]);
                tr.pos = tags[0];
                while (tr.pos < tags[1]) {
                    const k = keys[tr.varint()], v = values[tr.varint()];
                    if (!wanted || wanted.has(k)) props[k] = v;
                }
            }
            if (keep && !keep(props)) continue;

            for (const line of geometry(data, geom[0], geom[1], size, x0, y0)) {
                if (line.length >= 2) out.push({ properties: props, coordinates: line });
            }
        }
    }

    /** Команды геометрии: MoveTo(1) начинает линию, LineTo(2) продолжает */
    function geometry(data, start, end, size, x0, y0) {
        const r = new Reader(data, end);
        r.pos = start;
        const result = [];
        let line = null, cx = 0, cy = 0;
        while (r.pos < end) {
            const cmdLen = r.varint();
            const cmd = cmdLen & 0x7, count = cmdLen >> 3;
            if (cmd === 7) continue;                              // ClosePath — у линий не бывает
            for (let i = 0; i < count; i++) {
                cx += r.zigzag();
                cy += r.zigzag();
                if (cmd === 1) { line = []; result.push(line); }
                if (!line) continue;
                line.push(unproject(x0 + cx, y0 + cy, size));
            }
        }
        return result;
    }

    /** Координата тайла → градусы (сферическая Меркаторская сетка) */
    function unproject(px, py, size) {
        const lon = px * 360 / size - 180;
        const n = Math.PI - 2 * Math.PI * py / size;
        const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
    }

    root.MVT = { lines };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MVT;
})(typeof globalThis !== 'undefined' ? globalThis : window);
