#!/usr/bin/env python3
"""Листы «Спецкарты» → растровый MBTiles для приложения.

Нарезка идёт **от листов, а не от тайлов**: лист весит 116 МБ, и гонять его
с диска по нескольку раз ради каждого тайла дороже всего остального вместе
взятого. Тайлы группируются по широтной полосе листа, поэтому в LRU помещается
вся строка листов и каждый лист читается ровно один раз.

Тайлы 256 px, как у остальных растровых слоёв проекта (топо, хитмап). Максимум
z14 — это 9.5 м/px на широте Сербии; нативные 4.5 м/px скана (z15) увеличили бы
набор вчетверо ради зерна бумаги.

Поправки георефересовки берутся из `align.json` (см. `align_histmaps.py`):
на каждый лист — сетка смещений в градусах, между узлами интерполируем билинейно.

    python make_histmap_tiles.py sheets/ --align align.json --out serbia-histmap-v1.mbtiles
"""
import argparse
import glob
import io
import math
import json
import os
import sqlite3
import time

import numpy as np
from PIL import Image

from histmap_io import Sheet

TILE = 256
DOWNSAMPLE = 2           # 4.5 м/px → 9 м/px: ровно под z14, дальше не нужно

# Приведение тона листов. Тиражи и сканы у LoC разные: уровень бумаги гуляет
# от 198 до 244, контраст — в полтора раза. Без нормировки страна выглядит
# лоскутным одеялом, и швы между листами видно даже там, где геометрия сошлась
# идеально. Это артефакт печати и оцифровки, а не содержание карты, поэтому
# выравнивать его честно.
PAPER_LEVEL = 232        # медиана p95 по 71 листу
INK_LEVEL = 104          # медиана p5

# Цветных тиражей у LoC нашлось всего 8 из 71, и рядом с сепийными соседями
# они выглядят браком: на стыке карта резко меняет вид. Приводим их к тону
# монохромных — это медиана отношения каналов к яркости по 63 листам,
# нормированная так, что яркость не меняется.
SEPIA = np.array([1.0642, 0.9889, 0.8801], np.float32)


def lonlat_to_merc_px(lon, lat, zoom):
    """Координаты → пиксели глобальной сетки Web Mercator на данном зуме."""
    n = TILE * (1 << zoom)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def merc_px_to_lonlat(x, y, zoom):
    n = TILE * (1 << zoom)
    lon = x / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / n))))
    return lon, lat


class SheetCache:
    """Прореженные листы в памяти. Держим строку листов целиком."""

    def __init__(self, paths, limit=10):
        self.paths = paths
        self.limit = limit
        self.data = {}
        self.order = []
        self.loads = 0

    def get(self, name):
        if name in self.data:
            return self.data[name]
        sheet = Sheet(self.paths[name])
        h = sheet.height // DOWNSAMPLE
        w = sheet.width // DOWNSAMPLE
        img = np.empty((h, w, 3), np.uint8)
        band = 256 * DOWNSAMPLE
        for y0 in range(0, h * DOWNSAMPLE, band):
            rows = sheet.read_rows(y0, min(y0 + band, h * DOWNSAMPLE))
            rows = rows[:rows.shape[0] // DOWNSAMPLE * DOWNSAMPLE,
                        :w * DOWNSAMPLE]
            # Усреднение, а не прореживание: гравюра тонкая, децимация её рвёт
            small = rows.reshape(rows.shape[0] // DOWNSAMPLE, DOWNSAMPLE,
                                 w, DOWNSAMPLE, 3).mean(axis=(1, 3)).astype(np.uint8)
            img[y0 // DOWNSAMPLE:y0 // DOWNSAMPLE + small.shape[0]] = small
        normalize_tone(img)
        self.loads += 1
        self.data[name] = (sheet, img)
        self.order.append(name)
        while len(self.order) > self.limit:
            self.data.pop(self.order.pop(0), None)
        return self.data[name]


def normalize_tone(img):
    """Привести лист к общему виду: сепия, уровень бумаги, контраст.

    Растяжение считаем по яркости, а применяем ко всем каналам одинаково —
    так сепия остаётся сепией. Опорные точки берём по перцентилям: среднее
    испортила бы доля залитых лесом или застройкой участков.
    """
    # Цветной тираж определяем по хроматическим краскам — синей воде и зелёному
    # лесу. Насыщенность для этого не годится: сепия сама по себе «цветная»,
    # у неё разброс R−B доходит до 45 уровней.
    r, g, b = img[::4, ::4, 0].astype(np.int16), img[::4, ::4, 1].astype(np.int16), img[::4, ::4, 2].astype(np.int16)
    blue = ((b - r > 18) & (b - g > 6)).mean()
    green = ((g - r > 10) & (g - b > 4)).mean()
    if blue > 0.003 or green > 0.005:
        lum_full = (img[:, :, 0] * 0.3 + img[:, :, 1] * 0.59 + img[:, :, 2] * 0.11)
        img[:] = np.clip(lum_full[:, :, None] * SEPIA, 0, 255).astype(np.uint8)

    lum = (img[:, :, 0] * 0.3 + img[:, :, 1] * 0.59 + img[:, :, 2] * 0.11)
    sample = lum[::4, ::4]
    paper = float(np.percentile(sample, 95))
    ink = float(np.percentile(sample, 5))
    if paper - ink < 20:                     # почти пустой лист — не трогаем
        return
    gain = (PAPER_LEVEL - INK_LEVEL) / (paper - ink)
    if abs(gain - 1) < 0.02 and abs(paper - PAPER_LEVEL) < 3:
        return
    out = (img.astype(np.float32) - ink) * gain + INK_LEVEL
    np.clip(out, 0, 255, out=out)
    img[:] = out.astype(np.uint8)


def correction(align, name, u, v):
    """Смещение (dlon, dlat) в точке листа по сетке из align.json."""
    entry = align.get(name)
    if not entry:
        return 0.0, 0.0
    n = entry["grid"]
    fu = np.clip(u * n - 0.5, 0, n - 1)
    fv = np.clip(v * n - 0.5, 0, n - 1)
    i0, j0 = np.floor(fu).astype(int), np.floor(fv).astype(int)
    i1, j1 = np.minimum(i0 + 1, n - 1), np.minimum(j0 + 1, n - 1)
    tu, tv = fu - i0, fv - j0
    out = []
    for key in ("dlon", "dlat"):
        g = np.asarray(entry[key])
        out.append((g[j0, i0] * (1 - tu) * (1 - tv) + g[j0, i1] * tu * (1 - tv) +
                    g[j1, i0] * (1 - tu) * tv + g[j1, i1] * tu * tv))
    return out[0], out[1]


def render_tile(sheet, img, align, name, zoom, tx, ty):
    """Один тайл из одного листа. Возвращает (пиксели, маска заполненного)."""
    px0, py0 = tx * TILE, ty * TILE
    jj, ii = np.mgrid[0:TILE, 0:TILE]
    lon, lat = merc_px_to_lonlat(px0 + ii + 0.5, py0 + jj + 0.5, zoom)

    lon0, lat0, lon1, lat1 = sheet.bbox
    u = (lon - lon0) / (lon1 - lon0)
    v = (lat1 - lat) / (lat1 - lat0)
    dlon, dlat = correction(align, name, u, v)
    # Сетка поправки описывает, куда содержимое листа должно уехать, поэтому
    # обратное отображение вычитает её
    sx = (lon - dlon - sheet.lon0) / sheet.px / DOWNSAMPLE
    sy = (sheet.lat0 - (lat - dlat)) / sheet.py / DOWNSAMPLE

    h, w, _ = img.shape
    inside = (sx >= 0) & (sx <= w - 1.001) & (sy >= 0) & (sy <= h - 1.001)
    if not inside.any():
        return None, None

    xi = np.clip(sx, 0, w - 1.001)
    yi = np.clip(sy, 0, h - 1.001)
    x0, y0 = xi.astype(int), yi.astype(int)
    fx, fy = (xi - x0)[..., None], (yi - y0)[..., None]
    a = img[y0, x0].astype(np.float32)
    b = img[y0, x0 + 1].astype(np.float32)
    c = img[y0 + 1, x0].astype(np.float32)
    d = img[y0 + 1, x0 + 1].astype(np.float32)
    out = (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) +
           c * (1 - fx) * fy + d * fx * fy)
    return out.astype(np.uint8), inside


PAPER = np.array([243, 238, 225], np.uint8)   # цвет бумаги листа


def fill_holes(arr, done, max_iter=24):
    """Заделка щелей на стыке листов.

    Поправки георефересовки разводят соседние листы на единицы пикселей, и по
    шву пошла бы тёмная нить. Растим заполненное во все стороны — это дёшево
    и линейно; перебор ближайшего соседа на краевом тайле давал бы матрицу
    в миллиарды элементов.

    Дырой считаем только тонкий шов. Если пусто больше четверти тайла — это
    край набора, а не шов, и там честнее оставить поле бумаги, чем размазывать
    карту в пустоту.
    """
    if (~done).mean() > 0.25:
        arr[~done] = PAPER
        return
    for _ in range(max_iter):
        holes = ~done
        if not holes.any():
            return
        filled = False
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(np.roll(done, dy, 0), dx, 1)
            take = holes & src
            if not take.any():
                continue
            vals = np.roll(np.roll(arr, dy, 0), dx, 1)
            arr[take] = vals[take]
            done |= take
            holes = ~done
            filled = True
        if not filled:
            break
    arr[~done] = PAPER


def open_mbtiles(path, name, bounds, minzoom, maxzoom, attribution):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute("CREATE TABLE metadata (name text, value text)")
    db.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, "
               "tile_row integer, tile_data blob)")
    meta = {"name": name, "format": "jpg", "type": "overlay", "version": "1",
            "minzoom": str(minzoom), "maxzoom": str(maxzoom),
            "bounds": ",".join(f"{v:.5f}" for v in bounds),
            "attribution": attribution}
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    return db


def put(db, zoom, x, y, data):
    """MBTiles хранит строки по TMS — снизу вверх."""
    db.execute("INSERT INTO tiles VALUES (?,?,?,?)",
               (zoom, x, (1 << zoom) - 1 - y, sqlite3.Binary(data)))


def encode(arr, quality):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheets_dir")
    ap.add_argument("--align", default="align.json")
    ap.add_argument("--out", default="serbia-histmap-v1.mbtiles")
    ap.add_argument("--minzoom", type=int, default=8)
    ap.add_argument("--maxzoom", type=int, default=14)
    ap.add_argument("--quality", type=int, default=80)
    args = ap.parse_args()

    paths = {os.path.basename(p)[:-4]: p
             for p in sorted(glob.glob(os.path.join(args.sheets_dir, "*.tif")))}
    align = json.load(open(args.align, encoding="utf-8")) if os.path.exists(args.align) else {}
    if not align:
        print("⚠ align.json пуст — листы лягут по георефересовке LoC, со сдвигом")

    # Листы по широтным полосам: так LRU держит строку целиком
    boxes = {name: Sheet(p).bbox for name, p in paths.items()}
    rows = {}
    for name, bbox in boxes.items():
        rows.setdefault(round(bbox[3], 3), []).append(name)

    bounds = (min(b[0] for b in boxes.values()), min(b[1] for b in boxes.values()),
              max(b[2] for b in boxes.values()), max(b[3] for b in boxes.values()))
    db = open_mbtiles(args.out, "TOTSKII Wild — Србија 1:75 000 (1910-е)", bounds,
                      args.minzoom, args.maxzoom,
                      "Library of Congress · k.u.k. Militärgeographisches Institut")

    cache = SheetCache(paths, limit=10)
    z = args.maxzoom
    written = 0
    started = time.time()

    # Тайл на горизонтальном стыке двух рядов листов принадлежит обеим полосам:
    # каждая заполнит свою половину. Поэтому недособранные тайлы не пишем сразу,
    # а переносим в следующую полосу — там их достроит соседний ряд. Иначе по
    # каждому шву шла бы полоса чистой бумаги, а в базе — дубликаты ключей.
    pending = {}

    for ri, (lat_top, names) in enumerate(sorted(rows.items(), reverse=True), 1):
        tiles = pending
        pending = {}
        for name in sorted(names):
            sheet, img = cache.get(name)
            lon0, lat0, lon1, lat1 = sheet.bbox
            x0, y0 = lonlat_to_merc_px(lon0, lat1, z)
            x1, y1 = lonlat_to_merc_px(lon1, lat0, z)
            for tx in range(int(x0 // TILE), int(x1 // TILE) + 1):
                for ty in range(int(y0 // TILE), int(y1 // TILE) + 1):
                    part, mask = render_tile(sheet, img, align, name, z, tx, ty)
                    if part is None:
                        continue
                    key = (tx, ty)
                    if key not in tiles:
                        tiles[key] = [np.zeros((TILE, TILE, 3), np.uint8),
                                      np.zeros((TILE, TILE), bool)]
                    dst, done = tiles[key]
                    fill = mask & ~done
                    dst[fill] = part[fill]
                    done |= mask
        # Достроить недособранный тайл может только следующая полоса, и только
        # если он свисает за нижнюю границу текущей. Кромки набора (запад,
        # восток, дыра в Косове) не достроятся никогда — их переносить нельзя,
        # иначе они будут копиться в памяти до конца прогона.
        band_bottom = max(lonlat_to_merc_px(0, boxes[n][1], z)[1] for n in names)
        last_band = ri == len(rows)
        for (tx, ty), (arr, done) in tiles.items():
            if not done.any():
                continue
            if not done.all() and not last_band and (ty + 1) * TILE > band_bottom:
                pending[(tx, ty)] = [arr, done]     # дособерёт следующий ряд
                continue
            if not done.all():
                fill_holes(arr, done)
            put(db, z, tx, ty, encode(arr, args.quality))
            written += 1
        db.commit()
        print(f"[полоса {ri}/{len(rows)}] lat {lat_top:.2f}: тайлов {written}, "
              f"перенесено на стык {len(pending)}, "
              f"листов прочитано {cache.loads}, {time.time() - started:.0f} с", flush=True)

    # Пирамида вверх: каждый зум собирается из четырёх детей
    for z in range(args.maxzoom - 1, args.minzoom - 1, -1):
        cur = db.execute("SELECT tile_column, tile_row, tile_data FROM tiles "
                         "WHERE zoom_level=?", (z + 1,)).fetchall()
        parents = {}
        for x, row, data in cur:
            y = (1 << (z + 1)) - 1 - row
            parents.setdefault((x // 2, y // 2), []).append((x & 1, y & 1, data))
        for (px, py), kids in parents.items():
            canvas = Image.new("RGB", (TILE * 2, TILE * 2), (243, 238, 225))
            for kx, ky, data in kids:
                canvas.paste(Image.open(io.BytesIO(data)), (kx * TILE, ky * TILE))
            small = canvas.resize((TILE, TILE), Image.LANCZOS)
            put(db, z, px, py, encode(np.asarray(small), args.quality))
            written += 1
        db.commit()
        print(f"z{z}: {len(parents)} тайлов", flush=True)

    db.execute("CREATE UNIQUE INDEX tile_index ON tiles "
               "(zoom_level, tile_column, tile_row)")
    db.commit()
    size = os.path.getsize(args.out) / 1e6
    print(f"готово: {args.out}, тайлов {written}, {size:.0f} МБ, "
          f"{time.time() - started:.0f} с")


if __name__ == "__main__":
    main()
