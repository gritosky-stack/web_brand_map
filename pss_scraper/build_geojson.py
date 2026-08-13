"""
Build routes.geojson from the scraped route data + downloaded GPX files.
Run after scraper.py and fix_parse.py have completed.

Output: output/routes.geojson
"""

import json, re, xml.etree.ElementTree as ET
from pathlib import Path

OUTPUT    = Path("output")
GPX_DIR   = OUTPUT / "gpx"
ROUTES_IN = OUTPUT / "routes.json"
OUT_FILE  = OUTPUT / "routes.geojson"


def parse_gpx(path: Path) -> list[list[float]]:
    """Return [[lon, lat, ele?], ...] from a GPX file, handling namespace quirks."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    # 1. Strip xmlns declarations (including xmlns:prefix="...")
    clean = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', "", text)
    # 2. Strip namespaced attributes (e.g. xsi:schemaLocation="...", gpxx:attr="...")
    clean = re.sub(r'\s+\w+:[A-Za-z][^=\s]*="[^"]*"', "", clean)
    clean = re.sub(r"\s+\w+:[A-Za-z][^=\s]*='[^']*'", "", clean)
    # 3. Strip namespaced element tags (e.g. <gpxx:WaypointExtension>, </gpxx:...>)
    #    Replace <prefix:tag ...> with <tag ...> so structure is preserved
    clean = re.sub(r'<(/?)\w+:(\w+)', r'<\1\2', clean)

    try:
        root = ET.fromstring(clean)
    except ET.ParseError as e:
        print(f"  [xml error] {path.name}: {e}")
        return []

    coords: list[list[float]] = []

    for pt in root.iter("trkpt"):
        try:
            lat = float(pt.attrib["lat"])
            lon = float(pt.attrib["lon"])
            entry: list[float] = [lon, lat]
            ele = pt.find("ele")
            if ele is not None and ele.text:
                entry.append(float(ele.text.strip()))
            coords.append(entry)
        except (KeyError, ValueError):
            continue

    # Fall back to waypoints if no track points
    if not coords:
        for pt in root.iter("wpt"):
            try:
                lat = float(pt.attrib["lat"])
                lon = float(pt.attrib["lon"])
                coords.append([lon, lat])
            except (KeyError, ValueError):
                continue

    return coords


def slug_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def main():
    if not ROUTES_IN.exists():
        print(f"ERROR: {ROUTES_IN} not found. Run scraper.py + fix_parse.py first.")
        return

    routes = json.loads(ROUTES_IN.read_text())
    print(f"Loaded {len(routes)} routes from {ROUTES_IN}")

    features = []
    no_gpx   = 0
    no_file  = 0
    no_pts   = 0

    for route in routes:
        slug = route.get("slug") or slug_from_url(route.get("url", ""))
        gpx_path = GPX_DIR / f"{slug}.gpx"

        if not route.get("gpx_url"):
            no_gpx += 1
            continue

        if not gpx_path.exists():
            no_file += 1
            continue

        coords = parse_gpx(gpx_path)
        if len(coords) < 2:
            no_pts += 1
            continue

        # Downsample dense tracks — 400 pts is plenty for map display
        if len(coords) > 400:
            step = len(coords) / 400.0
            coords = [coords[int(i * step)] for i in range(400)]
            coords.append(parse_gpx(gpx_path)[-1])  # always keep last point

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords,
            },
            "properties": {
                "name":        route.get("name", slug),
                "slug":        slug,
                "url":         route.get("url", ""),
                "distance_km": route.get("distance_km"),
                "ascent_m":    route.get("ascent_m"),
                "descent_m":   route.get("descent_m"),
                "duration_h":  route.get("duration_h"),
                "difficulty":  route.get("difficulty"),
                "category":    route.get("category"),
                "region":      route.get("region"),
                "mountain":    route.get("mountain"),
                "pss_code":    route.get("pss_code"),
            },
        }
        features.append(feature)

    geojson = {"type": "FeatureCollection", "features": features}
    OUT_FILE.write_text(json.dumps(geojson, ensure_ascii=False, separators=(",", ":")))

    kb = OUT_FILE.stat().st_size // 1024
    print(f"""
─────────────────────────────────
GeoJSON built: {len(features)} features  ({kb} KB)
  no gpx_url  : {no_gpx}
  gpx missing : {no_file}
  empty gpx   : {no_pts}
─────────────────────────────────
Output → {OUT_FILE}

Next step:
  cp {OUT_FILE} ../hikingmap/hikingmap/Data/pss_routes.geojson
""")


if __name__ == "__main__":
    main()
