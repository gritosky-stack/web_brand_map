#!/usr/bin/env python3
"""Разрезает треки по разрывам.

Зачем: OSM отдаёт точки анонимных треков без времени и не в порядке
прохождения, а в порядке внутреннего индекса. Соединять всё подряд внутри
одного `trkseg` нельзя — получаются прямые через полстраны, и на карте
они выглядят оранжевыми полосами.

Настоящая пешая запись идёт с шагом в десятки метров. Поэтому режем линию
везде, где между соседними точками разрыв больше порога, и выбрасываем
огрызки короче двух точек.

    python split_traces.py out/traces/traces.geojsonl out/traces/clean.geojsonl --gap 250
"""
import argparse
import json
import math


def meters(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    # Плоское приближение: на сотнях метров ошибка ничтожна, а считается втрое быстрее
    dx = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110540
    return math.hypot(dx, dy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--gap", type=float, default=250, help="разрыв в метрах")
    ap.add_argument("--min-points", type=int, default=3)
    args = ap.parse_args()

    kept = 0
    dropped = 0
    read = 0

    with open(args.src) as src, open(args.dst, "w") as dst:
        for line in src:
            read += 1
            coords = json.loads(line)["geometry"]["coordinates"]
            piece = [coords[0]] if coords else []
            for prev, cur in zip(coords, coords[1:]):
                if meters(prev, cur) > args.gap:
                    if len(piece) >= args.min_points:
                        dst.write(json.dumps({
                            "type": "Feature", "properties": {},
                            "geometry": {"type": "LineString", "coordinates": piece},
                        }) + "\n")
                        kept += 1
                    else:
                        dropped += 1
                    piece = [cur]
                else:
                    piece.append(cur)
            if len(piece) >= args.min_points:
                dst.write(json.dumps({
                    "type": "Feature", "properties": {},
                    "geometry": {"type": "LineString", "coordinates": piece},
                }) + "\n")
                kept += 1
            else:
                dropped += 1

            if read % 5000 == 0:
                print(f"  прочитано {read}, получено кусков {kept}", flush=True)

    print(f"готово: из {read} линий получилось {kept} кусков, отброшено коротких {dropped}")


if __name__ == "__main__":
    main()
