#!/usr/bin/env python3
"""Горизонтали из Copernicus DEM 30 м → построчный GeoJSON для tippecanoe.

GDAL в системе нет (Homebrew на Ventura собирает его из исходников часами),
поэтому берём rasterio — его колесо тащит GDAL с собой — и считаем изолинии
через contourpy по каждому тайлу 1°×1° отдельно, чтобы не держать в памяти
всю страну.

Сетку задаём сразу в градусах: тогда результат contourpy — уже готовые
координаты, без обратного пересчёта из пикселей.

У каждой линии проставляем `ele` и `div`: div=1 обычная, 5 — каждая пятая,
10 — каждая десятая. По ним стиль рисует утолщённые линии и подписи, а
tippecanoe по ним же прореживает на мелких зумах.

    python make_contours.py dem/ out/contours.geojsonl --interval 20
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
import rasterio
from contourpy import contour_generator, LineType


def contours_for_tile(path, interval, out, stats):
    with rasterio.open(path) as src:
        band = src.read(1, masked=True)
        transform = src.transform
        rows, cols = band.shape

    if band.count() == 0:
        return

    data = np.ma.masked_invalid(band.astype(np.float64))
    lo, hi = float(data.min()), float(data.max())
    if not np.isfinite(lo) or not np.isfinite(hi):
        return

    # Центры пикселей в градусах — по ним contourpy сразу отдаёт lon/lat
    lon = transform.c + (np.arange(cols) + 0.5) * transform.a
    lat = transform.f + (np.arange(rows) + 0.5) * transform.e

    gen = contour_generator(x=lon, y=lat, z=data, line_type=LineType.Separate)

    start = int(np.floor(lo / interval) * interval)
    stop = int(np.ceil(hi / interval) * interval)
    for ele in range(max(start, 0), stop + interval, interval):
        for verts in gen.lines(float(ele)):
            if len(verts) < 2:
                continue
            # 5 знаков — это ~1 м на этой широте, дальше только раздувать файл
            coords = [[round(float(x), 5), round(float(y), 5)] for x, y in verts]
            div = 10 if ele % (interval * 10) == 0 else 5 if ele % (interval * 5) == 0 else 1
            # Все горизонтали разом читаемы только вблизи. Мелкие зумы получают
            # каждую десятую линию, средние — каждую пятую. tippecanoe понимает
            # tippecanoe:minzoom и сам выкинет лишнее на этапе нарезки.
            minzoom = 11 if div == 10 else 13 if div == 5 else 14
            out.write(json.dumps({
                "type": "Feature",
                "properties": {"ele": ele, "div": div},
                "tippecanoe": {"minzoom": minzoom},
                "geometry": {"type": "LineString", "coordinates": coords},
            }, ensure_ascii=False) + "\n")
            stats["lines"] += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dem_dir")
    ap.add_argument("out_path")
    ap.add_argument("--interval", type=int, default=20)
    args = ap.parse_args()

    tiles = sorted(glob.glob(os.path.join(args.dem_dir, "*.tif")))
    if not tiles:
        sys.exit(f"в {args.dem_dir} нет .tif")

    stats = {"lines": 0}
    with open(args.out_path, "w", encoding="utf-8") as out:
        for i, path in enumerate(tiles, 1):
            contours_for_tile(path, args.interval, out, stats)
            print(f"[{i}/{len(tiles)}] {os.path.basename(path)} — всего линий {stats['lines']}",
                  flush=True)

    size_mb = os.path.getsize(args.out_path) / 1048576
    print(f"готово: {args.out_path}, линий {stats['lines']}, {size_mb:.0f} МБ")


if __name__ == "__main__":
    main()
