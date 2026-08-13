"""
Second-pass parser: re-scrapes route pages using correct <strong> tag structure.
Run after scraper.py has collected all URLs.
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

BASE_URL  = "https://pss.rs"
OUTPUT    = Path("output")
SESSION   = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; HikingMapBot/1.0)"})
DELAY     = 1.2

STRONG_MAP = {
    "dužina":              "distance_km",
    "duzina":              "distance_km",
    "vreme obilaska":      "duration_h",
    "vreme hoda":          "duration_h",
    "vreme":               "duration_h",
    "visinska razlika":    "elevation_diff",  # "480/480" → split later
    "uspon":               "ascent_m",
    "spust":               "descent_m",
    "težina staze":        "difficulty",
    "tezina staze":        "difficulty",
    "težina":              "difficulty",
    "uređenost":           "condition",
    "uredjenost":          "condition",
    "markiranje":          "markings",
    "kategorija":          "category",
    "region":              "region",
    "planina":             "mountain",
}


def get_text_after_strong(strong_el) -> str:
    """Get the text node(s) that immediately follow a <strong> tag."""
    parts = []
    for sib in strong_el.next_siblings:
        if hasattr(sib, "name") and sib.name in ("strong", "br", "p", "div", "table"):
            break
        text = str(sib).strip()
        if text:
            parts.append(text)
        if len(parts) >= 3:
            break
    return " ".join(parts).strip().strip(":")


def parse_route_page(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    route = {"url": url, "slug": url.rstrip("/").split("/")[-1]}

    # Title
    h1 = soup.find("h1") or soup.find("h2")
    route["name"] = h1.get_text(strip=True) if h1 else route["slug"]

    # Parse <strong> labels
    for strong in soup.find_all("strong"):
        label = strong.get_text(strip=True).lower().rstrip(":")
        value = get_text_after_strong(strong).strip()

        if not value or len(value) > 200:
            continue

        for key_frag, field in STRONG_MAP.items():
            if key_frag in label:
                if field == "elevation_diff":
                    # "480/480" → ascent + descent
                    parts = re.split(r"[/|]", value)
                    if len(parts) >= 2:
                        m0 = re.search(r"\d+", parts[0])
                        m1 = re.search(r"\d+", parts[1])
                        if m0 and "ascent_m" not in route:
                            route["ascent_m"] = int(m0.group())
                        if m1 and "descent_m" not in route:
                            route["descent_m"] = int(m1.group())
                    elif re.search(r"\d+", value) and "ascent_m" not in route:
                        m = re.search(r"\d+", value)
                        route["ascent_m"] = int(m.group())
                elif field == "distance_km" and field not in route:
                    m = re.search(r"[\d,]+", value)
                    if m:
                        route[field] = float(m.group().replace(",", "."))
                elif field == "duration_h" and field not in route:
                    # Extract time pattern "4:30" or "6 h" or "4h 30min"
                    m = re.search(r"\d+[:\s]\d+|\d+\s*h", value)
                    route[field] = m.group().strip() if m else value
                elif field not in route:
                    route[field] = value
                break

    # GPX link
    for a in soup.find_all("a", href=True):
        if a["href"].endswith(".gpx"):
            route["gpx_url"] = urljoin(BASE_URL, a["href"])
            break

    if "gpx_url" not in route:
        route["gpx_url"] = None

    # PSS code from GPX filename
    if route.get("gpx_url"):
        m = re.search(r"/(\d+-\d+-\d+)[_-]", route["gpx_url"])
        if m:
            route["pss_code"] = m.group(1)

    # Description: first paragraph > 60 chars that isn't navigation
    skip_words = {"savez", "aktivnosti", "planinar", "komisija", "takmičen"}
    for p in soup.find_all("p"):
        txt = p.get_text(strip=True)
        if len(txt) > 60 and not any(w in txt.lower() for w in skip_words):
            route["description"] = txt[:500]
            break

    return route


def scrape_route(url: str) -> dict | None:
    try:
        r = SESSION.get(url, timeout=15)
        r.raise_for_status()
        return parse_route_page(r.text, url)
    except Exception as e:
        print(f"    [WARN] {url}: {e}")
        return None


def main():
    urls_file = OUTPUT / "urls.json"
    if not urls_file.exists():
        print("Run scraper.py first to collect URLs.")
        return

    all_urls = json.loads(urls_file.read_text())
    print(f"Re-parsing {len(all_urls)} route pages with improved parser…\n")

    routes = []
    for i, url in enumerate(all_urls, 1):
        slug = url.rstrip("/").split("/")[-1]
        print(f"  [{i:3d}/{len(all_urls)}] {slug}")
        route = scrape_route(url)
        if route:
            routes.append(route)
        if i % 50 == 0:
            _checkpoint(routes)
        time.sleep(DELAY)

    _checkpoint(routes)

    # Stats
    print(f"""
────────────────────────────────
Re-parse complete: {len(routes)} routes
  distance_km : {sum(1 for r in routes if r.get('distance_km'))}
  ascent_m    : {sum(1 for r in routes if r.get('ascent_m'))}
  duration_h  : {sum(1 for r in routes if r.get('duration_h'))}
  difficulty  : {sum(1 for r in routes if r.get('difficulty'))}
  gpx_url     : {sum(1 for r in routes if r.get('gpx_url'))}
────────────────────────────────""")


def _checkpoint(routes):
    out = OUTPUT / "routes.json"
    out.write_text(json.dumps(routes, ensure_ascii=False, indent=2))
    print(f"    ── saved {len(routes)} routes ──")


if __name__ == "__main__":
    main()
