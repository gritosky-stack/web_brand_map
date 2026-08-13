#!/usr/bin/env python3
"""Merge route_labels.json into routes_enriched.geojson -> routes_final.geojson.

Geometry stats (from enrich_geometry.py) are already in routes_enriched.geojson;
this fills mountain / region / difficulty / category from the labeling pass.
Existing non-empty values in the source are never overwritten.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GEO = os.path.join(HERE, "output", "routes_enriched.geojson")
LAB = os.path.join(HERE, "output", "route_labels.json")
OUT = os.path.join(HERE, "output", "routes_final.geojson")


def main():
    with open(GEO, encoding="utf-8") as f:
        gj = json.load(f)
    with open(LAB, encoding="utf-8") as f:
        labels = json.load(f)

    filled = 0
    for feat in gj["features"]:
        p = feat.setdefault("properties", {})
        lab = labels.get(p.get("slug"))
        if not lab:
            continue
        for k, v in lab.items():
            if v and not p.get(k):
                p[k] = v
        # heuristic field is now superseded by difficulty
        p.pop("difficulty_heuristic", None)
        filled += 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    print(f"merged labels into {filled} features -> {OUT}")

    # sanity: report fill rate of the key fields
    feats = gj["features"]
    for k in ("distance_km", "ascent_m", "duration_h", "mountain", "region",
              "difficulty", "category"):
        n = sum(1 for f in feats if f["properties"].get(k) not in (None, "", 0))
        print(f"  {k:12} filled: {n}/{len(feats)}")


if __name__ == "__main__":
    main()
