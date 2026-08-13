#!/usr/bin/env python3
"""Склеивает многодневный маршрут (несколько GPX «по дням») в один GPX-трек.

Зачем: и веб (`www/script.js` → parseGPX), и iOS (`GPXParser`) читают из файла
все <trkpt> подряд, в порядке следования. Значит, если положить дни в один файл
как отдельные <trk> в правильном порядке и правильной ориентации, маршрут
отобразится как единый — без правок кода в приложениях.

Что делает скрипт:
  • берёт точки треков из каждого дневного файла;
  • сам определяет ориентацию каждого дня (день N должен начинаться там,
    где закончился день N-1) и разворачивает трек, если он нарисован задом наперёд;
  • интерполирует пропущенные <ele> (в OsmAnd-планировщике такие точки бывают,
    а iOS-парсер подставляет вместо них 0 и ломает набор высоты);
  • пишет один GPX: по одному <trk> на день с именем «День N»;
  • печатает статистику по дням и итог — цифры для описания маршрута.

Пример:
    python3 tools/merge_gpx_days.py \
        --out "www/Samari - Dren. Kik Camp.gpx" \
        --name "Samari - Dren. Kik Camp" \
        "www/multiday/Dren. Kik Camp Day 1.gpx" \
        "www/multiday/Dren. Kik Camp Day 2.gpx"
"""

from __future__ import annotations

import argparse
import math
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass

GPX_NS = "http://www.topografix.com/GPX/1/1"
# Точки ближе этого расстояния друг к другу считаем «тем же местом» (стык дней).
JOIN_WARN_M = 150.0


@dataclass
class Pt:
    lat: float
    lon: float
    ele: float | None


def haversine(a: Pt, b: Pt) -> float:
    """Расстояние между точками в метрах."""
    r = 6371000.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp = p2 - p1
    dl = math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def read_track(path: str) -> list[Pt]:
    """Все <trkpt> файла в порядке следования."""
    root = ET.parse(path).getroot()
    pts: list[Pt] = []
    for node in root.iter(f"{{{GPX_NS}}}trkpt"):
        ele_node = node.find(f"{{{GPX_NS}}}ele")
        ele = None
        if ele_node is not None and (ele_node.text or "").strip():
            ele = float(ele_node.text.strip())
        pts.append(Pt(float(node.get("lat")), float(node.get("lon")), ele))
    if len(pts) < 2:
        raise SystemExit(f"{path}: в файле меньше двух <trkpt>")
    return pts


def fill_elevations(pts: list[Pt]) -> int:
    """Линейно интерполирует пропущенные высоты. Возвращает число заполненных точек."""
    known = [i for i, p in enumerate(pts) if p.ele is not None]
    if not known:
        raise SystemExit("в треке нет ни одной точки с <ele>")

    filled = 0
    for i, p in enumerate(pts):
        if p.ele is not None:
            continue
        prev = next((j for j in reversed(known) if j < i), None)
        nxt = next((j for j in known if j > i), None)
        if prev is not None and nxt is not None:
            r = (i - prev) / (nxt - prev)
            p.ele = pts[prev].ele + r * (pts[nxt].ele - pts[prev].ele)
        else:
            p.ele = pts[prev if prev is not None else nxt].ele
        filled += 1
    return filled


def orient(days: list[list[Pt]]) -> list[bool]:
    """Подбирает ориентацию дней так, чтобы стыки между ними были минимальны.

    Возвращает список флагов «день развёрнут». Для первого дня перебираем обе
    ориентации, дальше жадно цепляем каждый следующий день к концу предыдущего.
    """

    def chain(first_reversed: bool) -> tuple[list[bool], float]:
        flags = [first_reversed]
        cur = days[0][::-1] if first_reversed else days[0]
        tail = cur[-1]
        total_gap = 0.0
        for day in days[1:]:
            gap_fwd = haversine(tail, day[0])
            gap_rev = haversine(tail, day[-1])
            rev = gap_rev < gap_fwd
            flags.append(rev)
            total_gap += min(gap_fwd, gap_rev)
            tail = day[0] if rev else day[-1]
        return flags, total_gap

    straight, gap_straight = chain(False)
    flipped, gap_flipped = chain(True)
    return flipped if gap_flipped < gap_straight else straight


def stats(pts: list[Pt]) -> dict:
    dist = sum(haversine(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    ascent = descent = 0.0
    for i in range(1, len(pts)):
        d = pts[i].ele - pts[i - 1].ele
        if d > 0.3:
            ascent += d
        elif d < -0.3:
            descent += -d
    eles = [p.ele for p in pts]
    return {
        "km": dist / 1000,
        "asc": ascent,
        "desc": descent,
        "min": min(eles),
        "max": max(eles),
    }


def build_gpx(route_name: str, days: list[tuple[str, list[Pt]]]) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<gpx version="1.1" creator="merge_gpx_days.py" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 '
        'https://www.topografix.com/GPX/1/1/gpx.xsd">',
        "    <metadata>",
        f"        <name>{esc(route_name)}</name>",
        "    </metadata>",
    ]
    for title, pts in days:
        out.append("    <trk>")
        out.append(f"        <name>{esc(title)}</name>")
        out.append("        <trkseg>")
        for p in pts:
            out.append(
                f'            <trkpt lat="{p.lat:.7f}" lon="{p.lon:.7f}">'
                f"<ele>{p.ele:.1f}</ele></trkpt>"
            )
        out.append("        </trkseg>")
        out.append("    </trk>")
    out.append("</gpx>")
    out.append("")
    return "\n".join(out)


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("days", nargs="+", help="GPX-файлы по дням, в хронологическом порядке")
    ap.add_argument("--out", required=True, help="куда записать склеенный GPX")
    ap.add_argument("--name", help="имя маршрута в <metadata> (по умолчанию — имя файла)")
    ap.add_argument("--dry-run", action="store_true", help="только статистика, без записи")
    args = ap.parse_args()

    if len(args.days) < 2:
        return ap.error("нужно минимум два дневных файла")

    route_name = args.name or args.out.rsplit("/", 1)[-1].removesuffix(".gpx")
    days = [read_track(p) for p in args.days]
    flags = orient(days)

    merged_days: list[tuple[str, list[Pt]]] = []
    all_pts: list[Pt] = []
    print(f"Маршрут: {route_name}")
    for i, (path, pts, rev) in enumerate(zip(args.days, days, flags), start=1):
        pts = pts[::-1] if rev else list(pts)
        filled = fill_elevations(pts)
        s = stats(pts)
        note = " (развёрнут)" if rev else ""
        note += f", высот интерполировано: {filled}" if filled else ""
        print(f"  День {i}: {path.rsplit('/', 1)[-1]}{note}")
        print(f"          {len(pts)} точек, {s['km']:.2f} км, "
              f"+{s['asc']:.0f} / −{s['desc']:.0f} м, {s['min']:.0f}–{s['max']:.0f} м")
        if all_pts:
            gap = haversine(all_pts[-1], pts[0])
            flag = "  ⚠️ разрыв!" if gap > JOIN_WARN_M else ""
            print(f"          стык с предыдущим днём: {gap:.0f} м{flag}")
        merged_days.append((f"День {i}", pts))
        all_pts.extend(pts)

    total = stats(all_pts)
    print(f"  ИТОГО: {len(all_pts)} точек, {total['km']:.2f} км, "
          f"+{total['asc']:.0f} / −{total['desc']:.0f} м, "
          f"{total['min']:.0f}–{total['max']:.0f} м")

    if args.dry_run:
        print("(--dry-run: файл не записан)")
        return 0

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(build_gpx(route_name, merged_days))
    print(f"→ записано: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
