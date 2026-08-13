#!/usr/bin/env python3
"""Backfill elevation for routes whose source tracks lack it (has_elevation=false).

Samples up to 100 points along each flat track, queries the free OpenTopoData
SRTM 30 m dataset (no API key; 100 locations/request, ~1 request/sec), then
recomputes ascent / descent / elev range / duration and writes the values back
into routes_enriched.json AND routes_enriched.geojson. Re-run label_routes.py +
merge_labels.py afterwards so difficulty reflects the new ascent.

Idempotent: only touches routes that still have has_elevation=false.
"""
import json
import os
import time
import urllib.request
import urllib.parse

import enrich_geometry as eg

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_GEO = os.path.join(HERE, "output", "routes.geojson")
ENR_JSON = os.path.join(HERE, "output", "routes_enriched.json")
ENR_GEO = os.path.join(HERE, "output", "routes_enriched.geojson")

API = "https://api.opentopodata.org/v1/srtm30m"
MAX_PTS = 100          # OpenTopoData allows 100 locations/request
REQ_PAUSE = 1.1        # public API: max 1 request/second


def sample(coords, n=MAX_PTS):
    if len(coords) <= n:
        return coords
    step = (len(coords) - 1) / (n - 1)
    return [coords[round(i * step)] for i in range(n)]


def fetch_elevations(pts):
    locs = "|".join(f"{lat:.6f},{lon:.6f}" for lon, lat in pts)
    url = f"{API}?{urllib.parse.urlencode({'locations': locs})}"
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    if data.get("status") != "OK":
        raise RuntimeError(f"API status {data.get('status')}: {data.get('error')}")
    return [res["elevation"] for res in data["results"]]


def ascent_descent(elevs):
    sm = eg.smooth([e for e in elevs if e is not None])
    asc = desc = run = 0.0
    for a, b in zip(sm, sm[1:]):
        run += b - a
        if abs(run) >= eg.ELEV_NOISE_THRESHOLD:
            if run > 0:
                asc += run
            else:
                desc -= run
            run = 0.0
    return round(asc), round(desc)


def main():
    rows = json.load(open(ENR_JSON, encoding="utf-8"))
    geo = json.load(open(ENR_GEO, encoding="utf-8"))
    geom_by_slug = {f["properties"].get("slug"): f for f in geo["features"]}
    src_geom = {f["properties"].get("slug"): f["geometry"]
                for f in json.load(open(SRC_GEO, encoding="utf-8"))["features"]}

    todo = [r for r in rows if not r.get("has_elevation")]
    print(f"backfilling {len(todo)} routes without elevation...")

    done = 0
    for r in todo:
        slug = r["slug"]
        geom = src_geom.get(slug)
        coords = []
        if geom and geom["type"] == "LineString":
            coords = geom["coordinates"]
        elif geom and geom["type"] == "MultiLineString":
            for part in geom["coordinates"]:
                coords.extend(part)
        if len(coords) < 2:
            print(f"  skip {slug}: no usable geometry")
            continue

        pts = sample([(c[0], c[1]) for c in coords])
        try:
            elevs = fetch_elevations(pts)
        except Exception as e:  # noqa: BLE001 — log and continue
            print(f"  FAIL {slug}: {e}")
            time.sleep(REQ_PAUSE)
            continue

        valid = [e for e in elevs if e is not None]
        if len(valid) < 2:
            print(f"  no DEM data for {slug}")
            time.sleep(REQ_PAUSE)
            continue

        asc, desc = ascent_descent(elevs)
        dist = r.get("distance_km") or 0
        dur = round(dist / 4.5 + asc / 600.0, 1) if dist else None
        patch = {
            "ascent_m": asc, "descent_m": desc,
            "elev_min_m": round(min(valid)), "elev_max_m": round(max(valid)),
            "duration_h": dur, "has_elevation": True, "elevation_source": "srtm30m",
        }
        r.update(patch)
        if slug in geom_by_slug:
            geom_by_slug[slug]["properties"].update(patch)
        done += 1
        print(f"  {slug}: +{asc}m / -{desc}m, {patch['elev_min_m']}–{patch['elev_max_m']}m")
        time.sleep(REQ_PAUSE)

    json.dump(rows, open(ENR_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(geo, open(ENR_GEO, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\nbackfilled {done}/{len(todo)}. Now re-run: python3 label_routes.py && python3 merge_labels.py")


if __name__ == "__main__":
    main()
