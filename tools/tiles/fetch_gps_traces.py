#!/usr/bin/env python3
"""Выгрузка публичных GPS-треков OpenStreetMap по Сербии.

Зачем: хитмап на `gps.tile.openstreetmap.org` — чужие растровые тайлы, их
нельзя ни складывать в офлайн, ни выкачивать пачками (правила OSM это прямо
запрещают). Но сами треки — открытые данные, и API отдаёт их точками:

    /api/0.6/trackpoints?bbox=left,bottom,right,top&page=N

Ограничения API, из которых и растёт вся конструкция:
  • bbox не больше 0.25° по каждой стороне — значит режем страну на сетку;
  • страница отдаёт максимум 5000 точек, дальше пагинация;
  • сервер общий и бесплатный, поэтому идём в один поток с паузой между
    запросами и честно представляемся в User-Agent.

Результат — построчный GeoJSON с линиями треков, из него потом tippecanoe
соберёт слой рядом с горизонталями.

Прогресс пишется в state.json, так что скрипт можно прерывать и запускать
снова — уже забранные ячейки он пропустит.

    python fetch_gps_traces.py out/traces --delay 1.2
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

API = "https://api.openstreetmap.org/api/0.6/trackpoints"
UA = "TOTSKII-Wild/1.0 (hiking map for Serbia; offline heatmap build)"

# Сербия с Косовом
BBOX = (18.8, 41.8, 23.0, 46.2)
STEP = 0.25
MAX_PAGES = 40          # предохранитель: в плотных местах пагинация бесконечна
GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/0"}


def cells():
    left, bottom, right, top = BBOX
    lat = bottom
    while lat < top:
        lon = left
        while lon < right:
            yield (round(lon, 3), round(lat, 3),
                   round(min(lon + STEP, right), 3), round(min(lat + STEP, top), 3))
            lon += STEP
        lat += STEP


def fetch(bbox, page, delay, retries=4):
    url = f"{API}?bbox={bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}&page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 509):        # перегружен — ждём дольше
                time.sleep(delay * (attempt + 1) * 10)
                continue
            if e.code == 400:                    # слишком большой bbox или нет данных
                return None
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(delay * (attempt + 1) * 5)
    return None


def parse_segments(xml_bytes):
    """GPX → список линий. Точки без trkseg (одиночные) пропускаем."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return [], 0

    lines = []
    points = 0
    for seg in root.iter("{http://www.topografix.com/GPX/1/0}trkseg"):
        coords = []
        for pt in seg:
            lat = pt.get("lat")
            lon = pt.get("lon")
            if lat is None or lon is None:
                continue
            coords.append([round(float(lon), 5), round(float(lat), 5)])
            points += 1
        if len(coords) >= 2:
            lines.append(coords)
    return lines, points


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--delay", type=float, default=1.2, help="пауза между запросами, с")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    state_path = os.path.join(args.out_dir, "state.json")
    out_path = os.path.join(args.out_dir, "traces.geojsonl")

    state = {"done": []}
    if os.path.exists(state_path):
        state = json.load(open(state_path))
    done = set(tuple(c) for c in state["done"])

    all_cells = list(cells())
    print(f"ячеек всего: {len(all_cells)}, уже забрано: {len(done)}", flush=True)

    out = open(out_path, "a", encoding="utf-8")
    total_lines = 0
    total_points = 0

    try:
        for i, cell in enumerate(all_cells, 1):
            if cell in done:
                continue
            cell_lines = 0
            for page in range(MAX_PAGES):
                body = fetch(cell, page, args.delay)
                time.sleep(args.delay)
                if not body:
                    break
                lines, points = parse_segments(body)
                if not lines and points == 0:
                    break
                for coords in lines:
                    out.write(json.dumps({
                        "type": "Feature",
                        "properties": {},
                        "geometry": {"type": "LineString", "coordinates": coords},
                    }) + "\n")
                cell_lines += len(lines)
                total_lines += len(lines)
                total_points += points
                if points < 4900:        # страница неполная — данные кончились
                    break
            out.flush()
            done.add(cell)
            state["done"] = [list(c) for c in done]
            json.dump(state, open(state_path, "w"))
            print(f"[{i}/{len(all_cells)}] {cell} — линий {cell_lines}, "
                  f"всего {total_lines} линий / {total_points} точек", flush=True)
    finally:
        out.close()

    print(f"готово: {total_lines} линий, {total_points} точек → {out_path}")


if __name__ == "__main__":
    main()
