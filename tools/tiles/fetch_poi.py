#!/usr/bin/env python3
"""Точечные объекты для карты: вода и укрытия.

Берём из OpenStreetMap через Overpass — не из `.pbf`. Выкачивать ради
нескольких тысяч точек стошестидесятимегабайтный дамп страны незачем, а
Overpass отдаёт ровно нужное подмножество.

Два набора, по файлу на каждый — в приложении они включаются раздельно:

* **вода** — родники, колонки, колодцы, водоразборные точки;
* **укрытия** — планинарские дома, неохраняемые хижины, навесы, кемпинги.

    venv/bin/python fetch_poi.py ../../hikingmap/hikingmap/Data

⚠️ Полнота OSM по Сербии неровная, и родник может пересохнуть. Сезонность и
пригодность для питья кладём в свойства, чтобы приложение могло честно
оговориться, а не обещать воду там, где её может не быть.
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "totskii-wild-poi/1.0 (hiking map data)"

# Тот же контур, что фильтрует пещеры в приложении: bbox тянет соседей —
# Боснию, Венгрию, Румынию, Болгарию, Македонию, Албанию.
SERBIA_KOSOVO = [
    (46.18, 19.55), (46.18, 20.25), (45.97, 20.80), (45.10, 21.55),
    (44.70, 22.34), (44.40, 22.62), (43.80, 22.60), (43.20, 22.99),
    (42.35, 23.00), (42.30, 22.50), (41.90, 22.36), (42.00, 21.60),
    (41.85, 20.55), (42.55, 20.05), (43.00, 19.30), (43.55, 19.20),
    (43.72, 19.05), (44.35, 19.06), (44.85, 19.35), (45.10, 19.05),
    (45.80, 18.90), (45.95, 19.10), (45.87, 19.55),
]

SETS = {
    "water": {
        "filters": [
            'node["natural"="spring"]',
            'node["amenity"="drinking_water"]',
            'node["man_made"="water_well"]',
            'node["amenity"="water_point"]',
        ],
        "kind": lambda t: ("spring" if t.get("natural") == "spring" else
                           "well" if t.get("man_made") == "water_well" else
                           "tap"),
    },
    "shelters": {
        "filters": [
            'nwr["tourism"="alpine_hut"]',
            'nwr["tourism"="wilderness_hut"]',
            'nwr["amenity"="shelter"]',
            'nwr["tourism"="camp_site"]',
        ],
        "kind": lambda t: ("hut" if t.get("tourism") in ("alpine_hut", "wilderness_hut") else
                           "camp" if t.get("tourism") == "camp_site" else
                           "shelter"),
    },
}


def inside(lat, lon):
    poly, hit, j = SERBIA_KOSOVO, False, len(SERBIA_KOSOVO) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def query(body, cache_dir, tag, tries=4):
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{tag}.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    for attempt in range(tries):
        req = urllib.request.Request(
            OVERPASS, data=urllib.parse.urlencode({"data": body}).encode(),
            headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read().decode())
            json.dump(data, open(path, "w", encoding="utf-8"))
            return data
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            # Overpass под нагрузкой отвечает 429/504 — ждём и пробуем снова
            wait = 20 * (attempt + 1)
            print(f"    {tag}: {exc}; ещё раз через {wait} с", flush=True)
            time.sleep(wait)
    raise SystemExit(f"Overpass не ответил по {tag}")


def collect(name, spec, cache_dir):
    filters = "\n  ".join(f"{f}(41.7,18.8,46.2,23.1);" for f in spec["filters"])
    body = f"[out:json][timeout:280];\n(\n  {filters}\n);\nout center tags;"
    data = query(body, cache_dir, name)

    seen, out = set(), []
    for el in data.get("elements", []):
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None or not inside(lat, lon):
            continue
        tags = el.get("tags") or {}
        key = (round(lat, 5), round(lon, 5))
        if key in seen:
            continue
        seen.add(key)

        props = {"kind": spec["kind"](tags)}
        for src, dst in (("name", "name"), ("name:sr", "nameSr"), ("name:ru", "nameRu"),
                         ("operator", "operator"), ("ele", "ele"), ("description", "note")):
            if tags.get(src):
                props[dst] = tags[src]
        # Ключевые для похода свойства: пить или не пить и не пересыхает ли
        if tags.get("drinking_water") in ("yes", "no"):
            props["drinking"] = tags["drinking_water"] == "yes"
        elif tags.get("amenity") == "drinking_water":
            props["drinking"] = True
        if tags.get("seasonal") in ("yes", "no"):
            props["seasonal"] = tags["seasonal"] == "yes"
        if tags.get("shelter_type"):
            props["shelterType"] = tags["shelter_type"]
        if tags.get("fee") in ("yes", "no"):
            props["fee"] = tags["fee"] == "yes"

        out.append({"type": "Feature",
                    "id": f'{el["type"][0]}{el["id"]}',
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                    "properties": props})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", help="куда класть geojson (Data/ приложения)")
    ap.add_argument("--cache", default="work/poi")
    args = ap.parse_args()

    for name, spec in SETS.items():
        print(f"{name}: запрос…", flush=True)
        feats = collect(name, spec, args.cache)
        by_kind = {}
        for f in feats:
            by_kind[f["properties"]["kind"]] = by_kind.get(f["properties"]["kind"], 0) + 1
        path = os.path.join(args.out_dir, f"{name}.geojson")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
        size = os.path.getsize(path) / 1024
        print(f"  {len(feats)} точек ({by_kind}), {size:.0f} КБ → {path}", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
