#!/usr/bin/env python3
"""Enrich PSS routes.geojson with geometry-derived stats.

Reads output/routes.geojson (LineStrings with [lon, lat, elev] coords),
computes distance / ascent / descent / elevation range / start point / bbox /
Naismith time estimate, and writes output/routes_enriched.geojson plus a
flat output/routes_enriched.json (properties only) for inspection.

Source file is never modified. region/mountain/difficulty are left for the
LLM-labeling step and only get a cheap heuristic fallback here.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "output", "routes.geojson")
OUT_GEO = os.path.join(HERE, "output", "routes_enriched.geojson")
OUT_FLAT = os.path.join(HERE, "output", "routes_enriched.json")

# Ignore elevation deltas smaller than this (m) — GPS barometric noise would
# otherwise inflate ascent badly on flat tracks.
ELEV_NOISE_THRESHOLD = 4.0

# Plausible elevation range for Serbia (highest peak ~2169 m, margin for edges).
# Values outside this are treated as missing (0.0 placeholders, garbage spikes).
ELEV_MIN_VALID = 1.0
ELEV_MAX_VALID = 2700.0
# If fewer than this fraction of points have valid elevation, the track has no
# usable elevation and gets None (flagged for DEM backfill).
ELEV_MIN_COVERAGE = 0.5


def haversine_m(lon1, lat1, lon2, lat2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def smooth(values, window=5):
    """Simple centered moving average to tame elevation noise."""
    if len(values) < window:
        return values[:]
    half = window // 2
    out = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values), i + half + 1)
        seg = values[lo:hi]
        out.append(sum(seg) / len(seg))
    return out


def iter_lines(geom):
    """Yield coordinate lists for LineString or MultiLineString geometries."""
    if geom is None:
        return
    t = geom.get("type")
    if t == "LineString":
        yield geom["coordinates"]
    elif t == "MultiLineString":
        for part in geom["coordinates"]:
            yield part


def compute(coords_segments):
    dist_m = 0.0
    ascent = descent = 0.0
    valid_elevs = []          # only in-range elevations, for min/max
    n_elev_total = 0          # how many coords carried a 3rd value at all
    first_pt = None
    minlon = minlat = float("inf")
    maxlon = maxlat = float("-inf")
    n_points = 0
    # Per-segment valid-elevation series, used for thresholded ascent.
    elev_series = []

    for coords in coords_segments:
        if not coords:
            continue
        if first_pt is None:
            first_pt = [round(coords[0][0], 6), round(coords[0][1], 6)]
        n_points += len(coords)

        # 2D distance over consecutive points
        for a, b in zip(coords, coords[1:]):
            dist_m += haversine_m(a[0], a[1], b[0], b[1])

        # bbox
        for c in coords:
            minlon, maxlon = min(minlon, c[0]), max(maxlon, c[0])
            minlat, maxlat = min(minlat, c[1]), max(maxlat, c[1])

        # elevation: keep only plausible values, drop garbage spikes / 0 fills
        seg = []
        for c in coords:
            if len(c) > 2:
                n_elev_total += 1
                e = c[2]
                if ELEV_MIN_VALID <= e <= ELEV_MAX_VALID:
                    seg.append(e)
                    valid_elevs.append(e)
        if len(seg) >= 2:
            elev_series.append(seg)

    # Decide whether elevation is usable at all
    coverage = (len(valid_elevs) / n_elev_total) if n_elev_total else 0.0
    has_elev = n_elev_total > 0 and coverage >= ELEV_MIN_COVERAGE

    if has_elev:
        for seg in elev_series:
            sm = smooth(seg)
            run = 0.0
            for a, b in zip(sm, sm[1:]):
                run += b - a
                if abs(run) >= ELEV_NOISE_THRESHOLD:
                    if run > 0:
                        ascent += run
                    else:
                        descent += -run
                    run = 0.0

    dist_km = round(dist_m / 1000.0, 2)
    ascent_m = round(ascent) if has_elev else None
    descent_m = round(descent) if has_elev else None

    # Naismith: 4.5 km/h flat + 1 h per 600 m ascent (needs ascent)
    if dist_km and has_elev:
        duration_h = round(dist_km / 4.5 + ascent_m / 600.0, 1)
    else:
        duration_h = None

    out = {
        "distance_km": dist_km,
        "ascent_m": ascent_m,
        "descent_m": descent_m,
        "duration_h": duration_h,
        "elev_min_m": round(min(valid_elevs)) if has_elev else None,
        "elev_max_m": round(max(valid_elevs)) if has_elev else None,
        "has_elevation": has_elev,
        "start": first_pt,
        "n_points": n_points,
    }
    if all(v != float("inf") and v != float("-inf") for v in (minlon, minlat, maxlon, maxlat)):
        out["bbox"] = [round(minlon, 6), round(minlat, 6), round(maxlon, 6), round(maxlat, 6)]
    return out, dist_km, ascent_m


def difficulty_heuristic(dist_km, ascent_m):
    """Cheap fallback only — the LLM step refines this."""
    if not dist_km:
        return None
    # Without elevation, estimate effort from distance alone.
    score = dist_km + (ascent_m / 100.0 if ascent_m else 0.0)
    if score < 12:
        return "lako"
    if score < 22:
        return "srednje"
    if score < 34:
        return "tezko"
    return "vrlo tezko"


def main():
    with open(SRC, encoding="utf-8") as f:
        gj = json.load(f)

    flat = []
    ok = 0
    for feat in gj["features"]:
        props = feat.setdefault("properties", {})
        stats, dist_km, ascent_m = compute(list(iter_lines(feat.get("geometry"))))
        props.update(stats)
        if not props.get("difficulty"):
            props["difficulty_heuristic"] = difficulty_heuristic(dist_km, ascent_m)
        if dist_km:
            ok += 1
        flat.append({
            "slug": props.get("slug"),
            "name": props.get("name"),
            **stats,
            "difficulty_heuristic": props.get("difficulty_heuristic"),
        })

    with open(OUT_GEO, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    with open(OUT_FLAT, "w", encoding="utf-8") as f:
        json.dump(flat, f, ensure_ascii=False, indent=2)

    dists = [r["distance_km"] for r in flat if r["distance_km"]]
    asc = [r["ascent_m"] for r in flat if r["ascent_m"]]
    print(f"routes: {len(flat)}, with geometry: {ok}")
    if dists:
        print(f"distance_km  min/median/max: {min(dists)} / {sorted(dists)[len(dists)//2]} / {max(dists)}")
    if asc:
        print(f"ascent_m     min/median/max: {min(asc)} / {sorted(asc)[len(asc)//2]} / {max(asc)}")
    print(f"wrote {OUT_GEO}")
    print(f"wrote {OUT_FLAT}")


if __name__ == "__main__":
    main()
