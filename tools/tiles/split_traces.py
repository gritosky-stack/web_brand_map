#!/usr/bin/env python3
"""Отбраковывает неупорядоченные треки и режет остальные по разрывам.

Зачем: OSM отдаёт точки анонимных треков без времени и не в порядке
прохождения, а в порядке внутреннего индекса. Соединять всё подряд внутри
одного `trkseg` нельзя — получаются прямые через полстраны, и на карте
они выглядят оранжевыми полосами.

Одной резки по разрывам мало. Она убирает длинные перелёты, но в плотных
местах соседние по индексу точки лежат близко, порог не срабатывает, и из
мусора получаются короткие куски-обрывки. На карте это те самые фиолетовые
«гребёнки» — пучки параллельных полос поперёк склона.

Поэтому сначала решаем, упорядочена ли линия вообще. Признак прямой: у живой
записи направление меняется плавно, у перемешанной — случайно. Медианный угол
поворота между соседними точками делит выборку надвое без серой зоны:

    живые треки      0–30°   (медиана ~8°)
    перемешанные    90–180°  (пик на 180° — это и есть «гребёнка»)

Всё, что выше `--max-turn`, выбрасывается целиком: восстановить порядок точек
нельзя, а угадывать его — значит рисовать тропы, которых никто не проходил.

    python split_traces.py out/traces/traces.geojsonl out/traces/clean.geojsonl \
        --gap 250 --max-turn 60
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


def bearing(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    dx = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return math.degrees(math.atan2(lat2 - lat1, dx))


def median_turn(coords, sample=300):
    """Медианный угол поворота, в градусах. Для коротких линий — None."""
    n = len(coords)
    if n < 20:
        return None
    step = max(1, (n - 2) // sample)
    turns = []
    for i in range(1, n - 1, step):
        d = abs(bearing(coords[i], coords[i + 1]) - bearing(coords[i - 1], coords[i])) % 360
        turns.append(min(d, 360 - d))
    if not turns:
        return None
    turns.sort()
    return turns[len(turns) // 2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--gap", type=float, default=250, help="разрыв в метрах")
    ap.add_argument("--min-points", type=int, default=3)
    ap.add_argument("--max-turn", type=float, default=60,
                    help="медианный угол поворота, выше которого линия считается перемешанной")
    args = ap.parse_args()

    kept = 0
    dropped = 0
    read = 0
    shuffled = 0
    shuffled_points = 0

    with open(args.src) as src, open(args.dst, "w") as dst:
        for line in src:
            read += 1
            coords = json.loads(line)["geometry"]["coordinates"]

            turn = median_turn(coords)
            if turn is not None and turn > args.max_turn:
                shuffled += 1
                shuffled_points += len(coords)
                continue

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
                print(f"  прочитано {read}, получено кусков {kept}, "
                      f"перемешанных отброшено {shuffled}", flush=True)

    print(f"готово: из {read} линий получилось {kept} кусков, "
          f"отброшено коротких {dropped}")
    print(f"перемешанных линий выброшено: {shuffled} "
          f"({shuffled_points:,} точек)")


if __name__ == "__main__":
    main()
