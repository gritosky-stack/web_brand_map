#!/usr/bin/env python3
"""Листы австро-венгерской «Спецкарты» 1:75 000 на Сербию — из Library of Congress.

Набор `Spezialkarte der österreichisch-ungarischen Monarchie` (LoC, 4998 листов,
public domain) уже георефересован: каждый лист — GeoTIFF в EPSG:4326 с чистой
north-up аффинкой, поля обрезаны. Листы нарезаны по сетке 30′×15′ от меридиана
Ferro, поэтому соседние стыкуются точно, без варпинга.

Отбираем листы, попадающие в контур Сербии (тот же `serbia_region.geojson`, что
у офлайн-региона), по одному изданию на позицию. Изданий на лист бывает до
восьми — берём первое непустое: они отличаются годом, а не охватом.

    python fetch_histmaps.py sheets/            # ~72 листа, ~8.2 ГБ

Скрипт инкрементальный: уже скачанные листы пропускаются по размеру из манифеста.
"""
import argparse
import json
import os
import struct
import sys
import urllib.request

BASE = "https://data.labs.loc.gov/austro-hungarian-maps"
REGION = os.path.join(os.path.dirname(__file__),
                      "../../hikingmap/hikingmap/Data/serbia_region.geojson")


# LoC отдаёт 403 запросу без User-Agent — их CDN режет голый urllib
UA = "totskii-wild-tiles/1.0 (hiking map pipeline)"


def fetch(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def read_dbf(path):
    """Минимальный dBASE III: имена листов из индексного шейпфайла."""
    d = open(path, "rb").read()
    nrec, hlen, rlen = struct.unpack("<IHH", d[4:12])
    fields, off = [], 32
    while d[off] != 0x0D:
        name = d[off:off + 11].split(b"\0")[0].decode("latin1")
        fields.append((name, d[off + 16]))
        off += 32
    out = []
    for i in range(nrec):
        rec, o, row = d[hlen + i * rlen:hlen + (i + 1) * rlen], 1, {}
        for name, ln in fields:
            row[name] = rec[o:o + ln].decode("latin1").strip()
            o += ln
        out.append(row)
    return out


def read_shp_boxes(path):
    """Bbox каждой записи. Геометрия не нужна — листы и так прямоугольные."""
    d = open(path, "rb").read()
    off, boxes = 100, []
    while off < len(d):
        _, clen = struct.unpack(">II", d[off:off + 8])
        off += 8
        boxes.append(struct.unpack("<4d", d[off + 4:off + 36]))
        off += clen * 2
    return boxes


def load_region():
    gj = json.load(open(REGION, encoding="utf-8"))
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    rings = []
    for f in feats:
        g = f.get("geometry", f)
        if g["type"] == "Polygon":
            rings.append(g["coordinates"][0])
        else:
            for poly in g["coordinates"]:
                rings.append(poly[0])
    return rings


def inside(rings, x, y):
    for ring in rings:
        hit = False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                hit = not hit
        if hit:
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--index-dir", default="histindex",
                    help="куда класть индексный шейпфайл и манифест LoC")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    os.makedirs(args.index_dir, exist_ok=True)

    # 1. Индекс листов и манифест с размерами
    shp_dir = os.path.join(args.index_dir, "maps/data/index_shapefile")
    if not os.path.exists(os.path.join(shp_dir, "index.dbf")):
        zip_path = os.path.join(args.index_dir, "index_shapefile.zip")
        print("индекс листов…", flush=True)
        fetch(f"{BASE}/data/index_shapefile.zip", zip_path)
        import zipfile
        zipfile.ZipFile(zip_path).extractall(args.index_dir)

    man_path = os.path.join(args.index_dir, "manifest.json")
    if not os.path.exists(man_path):
        fetch(f"{BASE}/manifest.json", man_path)
    man = json.load(open(man_path))
    sizes = {}
    for row in man["rows"]:
        rec = dict(zip(man["cols"], row))
        if rec["filename"].startswith("sheets_geo/"):
            sizes[rec["filename"].split("/")[1].replace("_geo.tif", "")] = rec["size"]

    # 2. Листы, попадающие в контур Сербии, по одному изданию на позицию
    recs = read_dbf(os.path.join(shp_dir, "index.dbf"))
    boxes = read_shp_boxes(os.path.join(shp_dir, "index.shp"))
    rings = load_region()
    positions = {}
    for box, rec in zip(boxes, recs):
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        if not inside(rings, cx, cy):
            continue
        positions.setdefault((round(box[0], 3), round(box[1], 3)), []).append(
            (rec["name"], sizes.get(rec["name"], 0), box))

    picked = []
    for key in sorted(positions):
        # Первое непустое издание: они отличаются годом, а не охватом
        for name, size, box in sorted(positions[key]):
            if size > 0:
                picked.append((name, size, box))
                break

    total = sum(p[1] for p in picked)
    print(f"листов на Сербию: {len(picked)}, {total / 1e9:.1f} ГБ", flush=True)

    # 3. Качаем и попутно пишем bbox — тайлеру они пригодятся без разбора TIFF
    index = {}
    done = 0
    for i, (name, size, box) in enumerate(picked, 1):
        path = os.path.join(args.out_dir, f"{name}.tif")
        index[name] = {"bbox": [box[0], box[1], box[2], box[3]], "size": size}
        if os.path.exists(path) and os.path.getsize(path) == size:
            done += 1
            continue
        try:
            fetch(f"{BASE}/data/sheets_geo/{name}_geo.tif", path)
        except Exception as exc:                       # noqa: BLE001
            print(f"[{i}/{len(picked)}] {name}: не скачался — {exc}", flush=True)
            if os.path.exists(path):
                os.remove(path)
            continue
        done += 1
        print(f"[{i}/{len(picked)}] {name} — {os.path.getsize(path) / 1e6:.0f} МБ", flush=True)

    with open(os.path.join(args.out_dir, "sheets.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"готово: {done}/{len(picked)} листов в {args.out_dir}")
    if done < len(picked):
        sys.exit(1)


if __name__ == "__main__":
    main()
