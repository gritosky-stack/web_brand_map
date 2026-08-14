#!/usr/bin/env python3
"""Слияние нескольких OSM PBF в один файл.

Planetiler принимает только один входной файл, а Сербия и Косово лежат
у Geofabrik отдельными экстрактами.

Требования planetiler к порядку жёсткие, и обойти их не выйдет:
  1) сначала ВСЕ узлы, потом ВСЕ линии, потом отношения;
  2) внутри каждого типа — строго по возрастанию id.

Поэтому просто дописать один файл к другому нельзя: у Косова есть узлы
с меньшими id, чем у Сербии. Делаем слияние отсортированных потоков —
на каждом шаге берём объект с наименьшим id среди источников. Объекты,
попавшие в оба экстракта (приграничные), пишем один раз.

    python merge_pbf.py out.osm.pbf src/serbia.osm.pbf src/kosovo.osm.pbf
"""
import sys
import osmium


KINDS = [
    ("n", osmium.osm.NODE, "узлов"),
    ("w", osmium.osm.WAY, "линий"),
    ("r", osmium.osm.RELATION, "отношений"),
]


def stream(path, entity):
    """Объекты одного типа из файла, по возрастанию id."""
    return iter(osmium.FileProcessor(path, entity))


def merge_sorted(writers, sources, entity, add):
    """K-путевое слияние отсортированных потоков в один writer."""
    streams = [stream(src, entity) for src in sources]
    heads = []
    for it in streams:
        heads.append(next(it, None))

    written = 0
    dupes = 0
    last_id = None
    while True:
        best = None
        for i, obj in enumerate(heads):
            if obj is not None and (best is None or obj.id < heads[best].id):
                best = i
        if best is None:
            break

        obj = heads[best]
        if obj.id == last_id:
            dupes += 1
        else:
            add(obj)
            last_id = obj.id
            written += 1
        heads[best] = next(streams[best], None)

    return written, dupes


def main():
    out, sources = sys.argv[1], sys.argv[2:]
    writer = osmium.SimpleWriter(out)
    adders = {"n": writer.add_node, "w": writer.add_way, "r": writer.add_relation}
    try:
        for key, entity, name in KINDS:
            written, dupes = merge_sorted(writer, sources, entity, adders[key])
            print(f"{name}: {written}, пропущено дублей {dupes}", flush=True)
    finally:
        writer.close()
    print(f"готово: {out}")


if __name__ == "__main__":
    main()
