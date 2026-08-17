#!/usr/bin/env python3
"""Крутизна склонов растровым набором — накладывается поверх любой основы.

Отдельный полупрозрачный слой, а не своя основа: вопрос «можно ли тут срезать
напрямик или там стенка» возникает и на спутнике, и на топооснове, и на
гравюре. Поэтому пологое остаётся полностью прозрачным, а красится только то,
что круче порога.

Источник — Copernicus GLO-30, тот же, что уже лежит для горизонталей.
Отсюда и потолок зума: 30 м на пиксель это примерно z12 при плитке 512, и
рисовать z13+ значит выдавать интерполяцию за данные. Дальше SDK растянет
родительский тайл сам.

    venv/bin/python make_slope_tiles.py --dem work/dem --out work/serbia-slope-v1.mbtiles
"""
import argparse
import io
import math
import os
import sqlite3
import time

import numpy as np
from PIL import Image

from histmap_io import read_dem_window

TILE = 512

# Ступени как в лавинной практике: 30° — граница, с которой начинают считаться
# со склоном, 35° — где сходит большинство лавин, 45° — где начинается лазание.
STEPS = [
    (30.0, (255, 214,  64)),
    (35.0, (255, 140,  32)),
    (40.0, (232,  56,  40)),
    (45.0, (160,  36, 150)),
]
ALPHA = 115          # из 255: видно склон, но читается и то, что под ним


def lonlat_to_px(lon, lat, z):
    n = TILE * (1 << z)
    s = math.sin(math.radians(lat))
    return ((lon + 180.0) / 360.0 * n,
            (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)


def px_to_lonlat(x, y, z):
    n = TILE * (1 << z)
    return (x / n * 360.0 - 180.0,
            np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / n)))))


class Dem:
    """Окна DEM с кэшем: соседние тайлы почти всегда лежат в одном файле."""

    def __init__(self, dem_dir):
        import glob
        self.paths = sorted(glob.glob(os.path.join(dem_dir, "*.tif")))
        self.cache = {}

    def window(self, lon0, lat0, lon1, lat1):
        """Единая сетка на запрошенный прямоугольник.

        Тайл у границы попадает сразу в два файла Copernicus (они по градусу),
        и окна из них разного размера. Поэтому не сливаем массивы как есть, а
        раскладываем каждый по общей сетке — иначе на стыке градусов
        получается либо исключение, либо тихо обрезанный склон.
        """
        pieces = []
        for path in self.paths:
            key = (path, round(lon0, 4), round(lat0, 4), round(lon1, 4), round(lat1, 4))
            res = self.cache.get(key, "miss")
            if res == "miss":
                res = read_dem_window(path, lon0, lat0, lon1, lat1)
                if len(self.cache) > 96:
                    self.cache.clear()
                self.cache[key] = res
            if res is not None:
                pieces.append(res)
        if not pieces:
            return None

        step = pieces[0][3]
        w = int(round((lon1 - lon0) / step)) + 1
        h = int(round((lat1 - lat0) / step)) + 1
        if w < 3 or h < 3:
            return None
        grid = np.full((h, w), np.nan, np.float32)
        for a, ox, oy, st in pieces:
            xs = np.round((ox - lon0) / step).astype(int) + np.arange(a.shape[1])
            ys = np.round((lat1 - oy) / step).astype(int) + np.arange(a.shape[0])
            okx = (xs >= 0) & (xs < w)
            oky = (ys >= 0) & (ys < h)
            if not okx.any() or not oky.any():
                continue
            sub = a[np.ix_(oky, okx)]
            m = np.isfinite(sub)
            tgt = grid[np.ix_(ys[oky], xs[okx])]
            tgt[m] = sub[m]
            grid[np.ix_(ys[oky], xs[okx])] = tgt
        return (grid, lon0, lat1, step) if np.isfinite(grid).any() else None


def slope_tile(dem, z, tx, ty):
    """Крутизна в градусах для тайла или None, если DEM его не покрывает."""
    # Берём с запасом в один тайловый пиксель по краям: градиент на границе
    # иначе считался бы по обрезанному окну и давал шов
    lon0, lat1 = px_to_lonlat(tx * TILE, ty * TILE, z)
    lon1, lat0 = px_to_lonlat((tx + 1) * TILE, (ty + 1) * TILE, z)
    pad = (lon1 - lon0) * 0.02
    res = dem.window(lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad)
    if res is None:
        return None
    a, ox, oy, step = res
    if not np.isfinite(a).any():
        return None
    a = np.nan_to_num(a, nan=float(np.nanmedian(a)))

    # Крутизну считаем в сетке самого DEM — она грубее тайла, и считать её
    # по натянутой на тайл интерполяции значило бы измерять интерполяцию
    lat_c = (lat0 + lat1) / 2
    mx = step * 111320 * math.cos(math.radians(lat_c))
    my = step * 110570
    gy, gx = np.gradient(a)
    slope = np.degrees(np.arctan(np.hypot(gx / mx, gy / my)))

    # …и уже её натягиваем на пиксели тайла
    xs = np.linspace(lon0, lon1, TILE)
    ys = px_to_lonlat(0, np.arange(ty * TILE, (ty + 1) * TILE) + 0.5, z)[1]
    ix = np.clip(((xs - ox) / step), 0, slope.shape[1] - 1.001)
    iy = np.clip(((oy - ys) / step), 0, slope.shape[0] - 1.001)
    x0, y0 = ix.astype(int), iy.astype(int)
    fx, fy = ix - x0, iy - y0
    top = slope[y0][:, x0] * (1 - fx) + slope[y0][:, x0 + 1] * fx
    bot = slope[y0 + 1][:, x0] * (1 - fx) + slope[y0 + 1][:, x0 + 1] * fx
    return top * (1 - fy[:, None]) + bot * fy[:, None]


def colorize(slope):
    """Ступенчатая раскраска. Пологое — полностью прозрачно."""
    rgba = np.zeros(slope.shape + (4,), np.uint8)
    for limit, color in STEPS:
        m = slope >= limit
        if not m.any():
            continue
        rgba[m] = (*color, ALPHA)
    return rgba if rgba[:, :, 3].any() else None


def open_db(path, minzoom, maxzoom, bounds):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
    db.execute("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER,"
               " tile_row INTEGER, tile_data BLOB)")
    meta = {"name": "TOTSKII Wild — крутизна склонов", "format": "png",
            "type": "overlay", "version": "1", "minzoom": str(minzoom),
            "maxzoom": str(maxzoom), "bounds": ",".join(f"{b:.4f}" for b in bounds),
            "attribution": "Copernicus GLO-30 DEM"}
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    return db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", default="work/dem")
    ap.add_argument("--out", default="work/serbia-slope-v1.mbtiles")
    ap.add_argument("--minzoom", type=int, default=8)
    ap.add_argument("--maxzoom", type=int, default=12)
    ap.add_argument("--bounds", default="18.7,41.7,23.1,46.3")
    args = ap.parse_args()

    bounds = tuple(float(v) for v in args.bounds.split(","))
    dem = Dem(args.dem)
    db = open_db(args.out, args.minzoom, args.maxzoom, bounds)
    started = time.time()
    total = 0

    for z in range(args.minzoom, args.maxzoom + 1):
        x0, y0 = lonlat_to_px(bounds[0], bounds[3], z)
        x1, y1 = lonlat_to_px(bounds[2], bounds[1], z)
        written = 0
        for tx in range(int(x0 // TILE), int(x1 // TILE) + 1):
            for ty in range(int(y0 // TILE), int(y1 // TILE) + 1):
                s = slope_tile(dem, z, tx, ty)
                if s is None:
                    continue
                rgba = colorize(s)
                if rgba is None:            # всё пологое — тайл не нужен вовсе
                    continue
                buf = io.BytesIO()
                Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
                db.execute("INSERT INTO tiles VALUES (?,?,?,?)",
                           (z, tx, (1 << z) - 1 - ty, buf.getvalue()))
                written += 1
        db.commit()
        total += written
        print(f"z{z}: {written} тайлов, {time.time() - started:.0f} с", flush=True)

    db.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
    db.commit()
    size = os.path.getsize(args.out) / 1e6
    print(f"готово: {args.out}, тайлов {total}, {size:.0f} МБ, {time.time() - started:.0f} с")


if __name__ == "__main__":
    main()
