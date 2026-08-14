#!/usr/bin/env python3
"""Железные дороги и станции Сербии из OSM → построчный GeoJSON.

Схема OpenMapTiles отдаёт пути только с z8, а станции прячет в слой `poi`,
который начинается с z12. Нам нужно раньше: дороги с z6, станции с z9.
Поэтому тянем их из исходного экстракта сами и режем отдельным слоем.

Заодно фильтруем по «действующие»: заброшенные, разобранные, строящиеся и
проектируемые ветки в карту не идут. Трамваи и метро тоже — это городской
транспорт, а не то, чем добираются к началу маршрута.

    python extract_railways.py out/railways.geojsonl src/serbia.osm.pbf src/kosovo.osm.pbf
"""
import json
import sys

import osmium

# Что считаем действующей железной дорогой
LINE_TYPES = {"rail", "narrow_gauge", "light_rail", "preserved", "funicular"}
# Явные признаки, что ветка не работает
DEAD = {"abandoned", "disused", "razed", "dismantled", "construction", "proposed"}
STATION_TYPES = {"station", "halt", "stop"}


class Railways(osmium.SimpleHandler):
    def __init__(self, out):
        super().__init__()
        self.out = out
        self.lines = 0
        self.stations = 0

    def node(self, n):
        railway = n.tags.get("railway")
        if railway not in STATION_TYPES:
            return
        if n.tags.get("abandoned") or n.tags.get("disused"):
            return
        name = n.tags.get("name")
        if not name:
            return
        self.out.write(json.dumps({
            "type": "Feature",
            "properties": {
                "kind": "station",
                "subclass": railway,
                "name": name,
                # Все станции с одного зума: если часть появляется только при
                # приближении, это читается как баг, а не как разгрузка карты.
                # Разница между вокзалом и полустанком остаётся в оформлении.
                "tippecanoe": {"minzoom": 8},
            },
            "geometry": {"type": "Point",
                         "coordinates": [round(n.location.lon, 5), round(n.location.lat, 5)]},
        }, ensure_ascii=False) + "\n")
        self.stations += 1

    def way(self, w):
        railway = w.tags.get("railway")
        if railway not in LINE_TYPES:
            return
        if railway in DEAD or w.tags.get("railway:preserved") == "no":
            return
        # Отстойники и подъездные пути к промзонам загромождают карту
        service = w.tags.get("service")
        if service in ("yard", "siding", "spur", "crossover"):
            return

        try:
            coords = [[round(n.lon, 5), round(n.lat, 5)] for n in w.nodes if n.location.valid()]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2:
            return

        self.out.write(json.dumps({
            "type": "Feature",
            "properties": {
                "kind": "rail",
                "subclass": railway,
                "usage": w.tags.get("usage") or "",
                "name": w.tags.get("name") or "",
                "tippecanoe": {"minzoom": 6},
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        }, ensure_ascii=False) + "\n")
        self.lines += 1


def main():
    out_path, sources = sys.argv[1], sys.argv[2:]
    with open(out_path, "w", encoding="utf-8") as out:
        for src in sources:
            h = Railways(out)
            h.apply_file(src, locations=True)
            print(f"{src}: путей {h.lines}, станций {h.stations}", flush=True)
    print(f"готово: {out_path}")


if __name__ == "__main__":
    main()
