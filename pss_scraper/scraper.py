"""
PSS (Planinarski savez Srbije) trail scraper
Scrapes all hiking routes from pss.rs, downloads GPX files,
and exports to JSON + GeoJSON for use in the HikingMap app.

Usage:
    pip install requests beautifulsoup4 lxml
    python scraper.py

Output:
    output/routes.json      — all route metadata
    output/routes.geojson   — GeoJSON for map display
    output/gpx/             — GPX files
"""

import requests
from bs4 import BeautifulSoup
import json
import os
import time
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urljoin

BASE_URL   = "https://pss.rs"
LIST_URL   = "https://pss.rs/page/{page}/?post_type=terenipp"
TOTAL_PAGES = 170
OUTPUT_DIR  = Path("output")
GPX_DIR     = OUTPUT_DIR / "gpx"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; HikingMapBot/1.0; research use)"
})
DELAY = 1.5  # seconds between requests — be respectful

# ─────────────────────────────────────────────────────────
# Step 1: Collect all route URLs from listing pages
# ─────────────────────────────────────────────────────────

def get_route_urls_from_page(page: int) -> list[str]:
    url = LIST_URL.format(page=page)
    try:
        r = SESSION.get(url, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"  [WARN] page {page} failed: {e}")
        return []

    soup = BeautifulSoup(r.text, "lxml")
    urls = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/terenipp/" in href and href.rstrip("/").count("/") >= 3:
            full = urljoin(BASE_URL, href)
            if full not in urls:
                urls.append(full)
    return urls


def collect_all_urls() -> list[str]:
    print(f"Collecting route URLs from {TOTAL_PAGES} pages…")
    all_urls = []
    seen = set()
    for page in range(1, TOTAL_PAGES + 1):
        urls = get_route_urls_from_page(page)
        new = [u for u in urls if u not in seen]
        seen.update(new)
        all_urls.extend(new)
        print(f"  page {page:3d}/{TOTAL_PAGES} → +{len(new):2d} routes  (total: {len(all_urls)})")
        time.sleep(DELAY)
    print(f"Found {len(all_urls)} unique route URLs\n")
    return all_urls


# ─────────────────────────────────────────────────────────
# Step 2: Scrape individual route pages
# ─────────────────────────────────────────────────────────

FIELD_MAP = {
    # Serbian label variants → normalized key
    "dužina":           "distance_km",
    "duzina":           "distance_km",
    "ukupna dužina":    "distance_km",
    "vreme":            "duration_h",
    "vreme hoda":       "duration_h",
    "uspona":           "ascent_m",
    "uspon":            "ascent_m",
    "silaska":          "descent_m",
    "silaz":            "descent_m",
    "zahtevnost":       "difficulty",
    "kategorija":       "category",
    "oznake":           "markings",
    "stanje staze":     "condition",
    "stanje":           "condition",
    "region":           "region",
}

def parse_value(key: str, raw: str) -> str | float:
    """Convert raw string value to appropriate type."""
    raw = raw.strip()
    # Distance: "9.2 km" → 9.2
    if key == "distance_km":
        m = re.search(r"[\d.,]+", raw)
        if m:
            return float(m.group().replace(",", "."))
    # Ascent/descent: "498 m" → 498
    if key in ("ascent_m", "descent_m"):
        m = re.search(r"\d+", raw)
        if m:
            return int(m.group())
    # Duration: "6:00" or "6 h" → "6:00"
    return raw


def scrape_route(url: str) -> dict | None:
    try:
        r = SESSION.get(url, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"    [WARN] {url} → {e}")
        return None

    soup = BeautifulSoup(r.text, "lxml")
    route = {"url": url, "slug": url.rstrip("/").split("/")[-1]}

    # Title
    h1 = soup.find("h1") or soup.find("h2")
    route["name"] = h1.get_text(strip=True) if h1 else route["slug"]

    # Try to find a data table or definition list with route stats
    # PSS uses various layouts — try multiple patterns
    for row in soup.find_all(["tr", "li", "p"]):
        text = row.get_text(" ", strip=True).lower()
        for label, key in FIELD_MAP.items():
            if label in text and key not in route:
                # Try to get the value part (after the label)
                parts = re.split(r"[:\|]", row.get_text(" ", strip=True), maxsplit=1)
                if len(parts) == 2:
                    route[key] = parse_value(key, parts[1])

    # Also try dt/dd pairs
    for dt in soup.find_all("dt"):
        label_text = dt.get_text(strip=True).lower()
        dd = dt.find_next_sibling("dd")
        if dd:
            for label, key in FIELD_MAP.items():
                if label in label_text and key not in route:
                    route[key] = parse_value(key, dd.get_text(strip=True))

    # Description (first substantial paragraph)
    desc_paras = [p.get_text(strip=True) for p in soup.find_all("p")
                  if len(p.get_text(strip=True)) > 80]
    if desc_paras:
        route["description"] = desc_paras[0]

    # GPX download link
    gpx_link = None
    for a in soup.find_all("a", href=True):
        if a["href"].endswith(".gpx"):
            gpx_link = urljoin(BASE_URL, a["href"])
            break
    route["gpx_url"] = gpx_link

    # Region number from URL structure (e.g. 4-49-2 → region 4)
    m = re.search(r"/(\d+)-(\d+)-(\d+)_", gpx_link or "")
    if m:
        route["pss_code"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    return route


# ─────────────────────────────────────────────────────────
# Step 3: Download GPX files and parse coordinates
# ─────────────────────────────────────────────────────────

def download_gpx(route: dict) -> list[list[float]] | None:
    """Download GPX and return [[lon, lat], ...] coordinate list."""
    if not route.get("gpx_url"):
        return None

    fname = GPX_DIR / (route["slug"] + ".gpx")
    if fname.exists():
        gpx_text = fname.read_text(encoding="utf-8", errors="ignore")
    else:
        try:
            r = SESSION.get(route["gpx_url"], timeout=20)
            r.raise_for_status()
            gpx_text = r.text
            fname.write_text(gpx_text, encoding="utf-8")
            time.sleep(DELAY)
        except Exception as e:
            print(f"    [WARN] GPX download failed for {route['slug']}: {e}")
            return None

    return parse_gpx_coords(gpx_text)


def parse_gpx_coords(gpx_text: str) -> list[list[float]]:
    """Parse GPX XML and return [[lon, lat, ele?], ...] list."""
    try:
        # Strip namespace for easier parsing
        gpx_text_clean = re.sub(r'\sxmlns[^"]*"[^"]*"', "", gpx_text)
        root = ET.fromstring(gpx_text_clean)
    except ET.ParseError:
        return []

    coords = []
    for pt in root.iter("trkpt"):
        try:
            lat = float(pt.attrib["lat"])
            lon = float(pt.attrib["lon"])
            ele_el = pt.find("ele")
            entry = [lon, lat]
            if ele_el is not None and ele_el.text:
                entry.append(float(ele_el.text))
            coords.append(entry)
        except (KeyError, ValueError):
            continue

    # Also try waypoints if no track points
    if not coords:
        for pt in root.iter("wpt"):
            try:
                lat = float(pt.attrib["lat"])
                lon = float(pt.attrib["lon"])
                coords.append([lon, lat])
            except (KeyError, ValueError):
                continue

    return coords


# ─────────────────────────────────────────────────────────
# Step 4: Build GeoJSON
# ─────────────────────────────────────────────────────────

def build_geojson(routes: list[dict]) -> dict:
    features = []
    for route in routes:
        coords = route.pop("_coords", None)
        if not coords:
            continue
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            },
            "properties": {
                "name":        route.get("name", ""),
                "slug":        route.get("slug", ""),
                "url":         route.get("url", ""),
                "distance_km": route.get("distance_km"),
                "ascent_m":    route.get("ascent_m"),
                "descent_m":   route.get("descent_m"),
                "duration_h":  route.get("duration_h"),
                "difficulty":  route.get("difficulty"),
                "category":    route.get("category"),
                "region":      route.get("region"),
                "pss_code":    route.get("pss_code"),
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    GPX_DIR.mkdir(exist_ok=True)

    # ── 1. Collect URLs (or load from cache) ──────────────
    urls_cache = OUTPUT_DIR / "urls.json"
    if urls_cache.exists():
        all_urls = json.loads(urls_cache.read_text())
        print(f"Loaded {len(all_urls)} URLs from cache")
    else:
        all_urls = collect_all_urls()
        urls_cache.write_text(json.dumps(all_urls, ensure_ascii=False, indent=2))

    # ── 2. Scrape route pages (resume if interrupted) ─────
    routes_cache = OUTPUT_DIR / "routes_raw.json"
    if routes_cache.exists():
        routes = json.loads(routes_cache.read_text())
        done_urls = {r["url"] for r in routes}
        remaining = [u for u in all_urls if u not in done_urls]
        print(f"Resuming: {len(routes)} done, {len(remaining)} remaining")
    else:
        routes = []
        remaining = all_urls

    for i, url in enumerate(remaining, 1):
        print(f"  [{i:3d}/{len(remaining)}] {url.split('/')[-2]}")
        route = scrape_route(url)
        if route:
            routes.append(route)
        if i % 20 == 0:
            routes_cache.write_text(json.dumps(routes, ensure_ascii=False, indent=2))
            print(f"  ── checkpoint saved ({len(routes)} routes) ──")
        time.sleep(DELAY)

    routes_cache.write_text(json.dumps(routes, ensure_ascii=False, indent=2))
    print(f"\nScraped {len(routes)} routes")

    # ── 3. Download GPX + parse coords ────────────────────
    has_gpx = [r for r in routes if r.get("gpx_url")]
    print(f"\nDownloading GPX for {len(has_gpx)} routes…")
    for i, route in enumerate(has_gpx, 1):
        print(f"  [{i:3d}/{len(has_gpx)}] {route['slug']}")
        coords = download_gpx(route)
        if coords:
            route["_coords"] = coords
            print(f"           → {len(coords)} points")

    # ── 4. Save final JSON (clean, no _coords) ────────────
    clean_routes = []
    for r in routes:
        cr = {k: v for k, v in r.items() if not k.startswith("_")}
        clean_routes.append(cr)

    json_out = OUTPUT_DIR / "routes.json"
    json_out.write_text(json.dumps(clean_routes, ensure_ascii=False, indent=2))
    print(f"\nSaved {len(clean_routes)} routes → {json_out}")

    # ── 5. Build and save GeoJSON ─────────────────────────
    # Re-attach coords for geojson
    for route in routes:
        coords = route.get("_coords")
        if coords:
            for cr in clean_routes:
                if cr["url"] == route["url"]:
                    cr["_coords"] = coords

    geojson = build_geojson(clean_routes)
    geojson_out = OUTPUT_DIR / "routes.geojson"
    geojson_out.write_text(json.dumps(geojson, ensure_ascii=False, indent=2))
    print(f"Saved GeoJSON ({len(geojson['features'])} features with coords) → {geojson_out}")

    # ── Summary ───────────────────────────────────────────
    with_gpx    = len(has_gpx)
    with_coords = len(geojson["features"])
    no_gpx      = len(clean_routes) - with_gpx
    print(f"""
──────────────────────────────
Done!
  Total routes scraped : {len(clean_routes)}
  With GPX file        : {with_gpx}
  With parsed coords   : {with_coords}
  Metadata only        : {no_gpx}
──────────────────────────────
Files:
  {json_out}
  {geojson_out}
  {GPX_DIR}/ ({with_gpx} .gpx files)
    """)


if __name__ == "__main__":
    main()
