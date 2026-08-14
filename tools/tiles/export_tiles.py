#!/usr/bin/env python3
"""Раскладка MBTiles в дерево файлов {z}/{x}/{y}.pbf.

Зачем: перехватить HTTP-запрос Mapbox и отдать тайл из своего файла нельзя —
у HttpResponse в SDK нет публичного конструктора. Зато есть LocalFileSource,
который умеет схему file://, поэтому тайлы кладём на диск обычными файлами.

Две тонкости:
  • MBTiles хранит y по схеме TMS (снизу вверх), а тайловые шаблоны ждут XYZ;
  • тайлы внутри лежат gzip-сжатыми, а при чтении по file:// заголовков нет
    и распаковать их некому — поэтому распаковываем заранее.

    python export_tiles.py out/serbia-topo.mbtiles out/tiles [--maxzoom 14]
"""
import argparse
import gzip
import os
import sqlite3
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mbtiles")
    ap.add_argument("out_dir")
    ap.add_argument("--maxzoom", type=int, default=None)
    args = ap.parse_args()

    db = sqlite3.connect(args.mbtiles)
    where = "" if args.maxzoom is None else f" where zoom_level <= {args.maxzoom}"
    total = db.execute(f"select count(*) from tiles{where}").fetchone()[0]
    print(f"тайлов к выгрузке: {total}")

    done = 0
    bytes_out = 0
    cur = db.execute(
        f"select zoom_level, tile_column, tile_row, tile_data from tiles{where}"
    )
    for z, x, tms_y, data in cur:
        y = (1 << z) - 1 - tms_y          # TMS → XYZ
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)

        folder = os.path.join(args.out_dir, str(z), str(x))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"{y}.pbf"), "wb") as f:
            f.write(data)

        done += 1
        bytes_out += len(data)
        if done % 10000 == 0:
            print(f"  {done}/{total} ({bytes_out/1048576:.0f} МБ)", flush=True)

    print(f"готово: {done} тайлов, {bytes_out/1048576:.0f} МБ в {args.out_dir}")


if __name__ == "__main__":
    main()
