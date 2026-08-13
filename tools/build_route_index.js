#!/usr/bin/env node
/**
 * Собирает www/routes_geom.json — предпосчитанную геометрию и статистику всех
 * маршрутов + GPS-координаты фотографий.
 *
 * Зачем: раньше сайт на старте тянул ВСЕ .gpx (~11 МБ) и разбирал их в главном
 * потоке — с фильтрацией выбросов, сглаживанием и RDP по сотням тысяч точек.
 * Плюс на каждый маршрут скачивал фотографии целиком (в среднем 2.6 МБ штука),
 * только чтобы вытащить GPS из EXIF. Теперь всё это считается один раз здесь.
 *
 * Чтобы цифры на сайте не разъехались с этим скриптом, он не повторяет логику
 * разбора, а вытаскивает и исполняет НАСТОЯЩИЕ функции из www/script.js
 * (parseGPX / simplifyRDP / haversineDistance / _rdpDist) поверх @xmldom.
 *
 * Запуск (после добавления маршрута или фото):
 *     node tools/build_route_index.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW  = path.join(ROOT, 'www');
const OUT  = path.join(WWW, 'routes_geom.json');
const COORD_PRECISION = 5;   // ~1 м — на линии маршрута разницы не видно

const { DOMParser } = require(path.join(ROOT, 'node_modules', '@xmldom', 'xmldom'));
global.DOMParser = DOMParser;

const src = fs.readFileSync(path.join(WWW, 'script.js'), 'utf8');

// ── Достаём из script.js то, что нужно для разбора ────────────────────────────
function extractFunction(name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`не нашёл function ${name} в script.js`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`не смог дочитать function ${name}`);
}

function extractRoutes() {
    const start = src.indexOf('const routesList = [');
    const end   = src.indexOf('// ── Caches', start);
    if (start < 0 || end < 0) throw new Error('не нашёл блок с описанием маршрутов в script.js');
    // в этом куске script.js сам объявляет `const routes = {}` и наполняет его
    return new Function(src.slice(start, end) + '\nreturn routes;')();
}

const parse = new Function(
    'gpxString',
    [extractFunction('haversineDistance'), extractFunction('_rdpDist'),
     extractFunction('simplifyRDP'), extractFunction('parseGPX'),
     'return parseGPX(gpxString);'].join('\n')
);

// ── Мини-читалка GPS из EXIF ──────────────────────────────────────────────────
// Хватает первых 128 КБ файла: EXIF лежит в APP1 сразу за SOI.
function readGps(file) {
    let buf;
    try {
        const fd = fs.openSync(file, 'r');
        buf = Buffer.alloc(131072);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        buf = buf.subarray(0, n);
    } catch { return null; }

    if (buf.length < 4 || buf.readUInt16BE(0) !== 0xFFD8) return null;   // не JPEG

    // ищем сегмент APP1 (Exif\0\0)
    let off = 2, app1 = -1;
    while (off + 4 <= buf.length) {
        if (buf[off] !== 0xFF) break;
        const marker = buf[off + 1];
        const size   = buf.readUInt16BE(off + 2);
        if (marker === 0xE1 && buf.toString('ascii', off + 4, off + 8) === 'Exif') {
            app1 = off + 10;
            break;
        }
        if (marker === 0xDA) break;                                      // пошли данные картинки
        off += 2 + size;
    }
    if (app1 < 0 || app1 + 8 > buf.length) return null;

    const le = buf.toString('ascii', app1, app1 + 2) === 'II';
    const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);

    const readIfd = (ifdOff, wanted) => {
        const out = {};
        if (ifdOff + 2 > buf.length) return out;
        const count = u16(ifdOff);
        for (let i = 0; i < count; i++) {
            const e = ifdOff + 2 + i * 12;
            if (e + 12 > buf.length) break;
            const tag = u16(e);
            if (!wanted.includes(tag)) continue;
            const type = u16(e + 2), num = u32(e + 4);
            const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 })[type] || 1;
            const total = size * num;
            const valOff = total <= 4 ? e + 8 : app1 + u32(e + 8);
            out[tag] = { type, num, valOff };
        }
        return out;
    };
    const rational = (o, n) => {
        const vals = [];
        for (let i = 0; i < n; i++) {
            if (o + i * 8 + 8 > buf.length) return null;
            const den = u32(o + i * 8 + 4);
            vals.push(den ? u32(o + i * 8) / den : 0);
        }
        return vals;
    };

    const ifd0 = readIfd(app1 + u32(app1 + 4), [0x8825]);                // GPSInfoIFDPointer
    if (!ifd0[0x8825]) return null;
    const gpsIfd = readIfd(app1 + u32(ifd0[0x8825].valOff), [1, 2, 3, 4]);
    if (!gpsIfd[2] || !gpsIfd[4]) return null;

    const dms = tag => {
        const v = rational(gpsIfd[tag].valOff, 3);
        return v ? v[0] + v[1] / 60 + v[2] / 3600 : null;
    };
    let lat = dms(2), lon = dms(4);
    if (lat === null || lon === null) return null;
    if (gpsIfd[1] && String.fromCharCode(buf[gpsIfd[1].valOff]) === 'S') lat = -lat;
    if (gpsIfd[3] && String.fromCharCode(buf[gpsIfd[3].valOff]) === 'W') lon = -lon;
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return [+lon.toFixed(7), +lat.toFixed(7)];
}

// ── Сборка ────────────────────────────────────────────────────────────────────
const round = n => +n.toFixed(COORD_PRECISION);
const routes = extractRoutes();
const index  = { version: 1, generated: new Date().toISOString().slice(0, 10), routes: {} };

let totalPhotos = 0, withGps = 0, skipped = 0;

for (const [id, route] of Object.entries(routes)) {
    const gpxPath = path.join(WWW, route.file);
    if (!fs.existsSync(gpxPath)) {
        console.warn(`  ⚠️  нет файла ${route.file} — маршрут ${id} пропущен`);
        skipped++;
        continue;
    }
    const data = parse(fs.readFileSync(gpxPath, 'utf8'));
    if (!data) {
        console.warn(`  ⚠️  ${route.file}: не разобрался, пропускаю`);
        skipped++;
        continue;
    }

    const photos = {};
    for (const src of route.photos || []) {
        totalPhotos++;
        const coords = readGps(path.join(WWW, src));
        if (coords) withGps++;
        photos[src] = coords;   // null — фото без GPS, маркер на карте не ставим
    }

    index.routes[id] = {
        file:             route.file,
        coordinates:      data.coordinates.map(c => [round(c[0]), round(c[1])]),
        peakCoords:       data.peakCoords.map(round),
        center:           data.center.map(round),
        bounds:           data.bounds.map(b => b.map(round)),
        distance:         data.distance,
        ascent:           data.ascent,
        descent:          data.descent,
        minEle:           data.minEle,
        maxEle:           data.maxEle,
        formattedTime:    data.formattedTime,
        elevationProfile: data.elevationProfile,
        photoGps: photos
    };
    console.log(`  ${id.padEnd(10)} ${route.name}: ${data.coordinates.length} точек, ` +
                `${data.distance} км, фото ${Object.keys(photos).length}`);
}

fs.writeFileSync(OUT, JSON.stringify(index));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\n→ ${path.relative(ROOT, OUT)}: ${Object.keys(index.routes).length} маршрутов, ${kb} КБ` +
            (skipped ? ` (пропущено ${skipped})` : ''));
console.log(`   фото: ${totalPhotos}, с GPS: ${withGps}, без GPS: ${totalPhotos - withGps}`);
