#!/usr/bin/env python3
"""Облегчённые копии слоёв приложения для сайта.

Приложение держит данные в бандле (`hikingmap/hikingmap/Data/`), а сайт
качает их по сети, поэтому в `www/` кладём урезанные версии:

- `railways.geojson` — пути упрощены (RDP ≈ 4 м) и без свойств, у станций
  только имя и признак вокзала (`major` = `subclass == station`, как
  `isMajor` в `RailwayStore.swift`). 1.6 МБ → 0.9 МБ;
- `caves.geojson` — приведён к полям `map_points.js` (`kind`, `name`,
  `nameSr`, `ele`) плюс длина, глубина, платность;
- `histmap_coverage.geojson` — как есть (рамка съёмки «Спецкарты»).

    python3 tools/web_layer_data.py

Обновил данные в приложении — перезапусти, иначе на сайте останутся старые.
"""
import json
import math
import os
import shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'hikingmap', 'hikingmap', 'Data')
DST = os.path.join(ROOT, 'www')


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    best, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = (abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length if length
             else math.hypot(p[0] - a[0], p[1] - a[1]))
        if d > best:
            best, idx = d, i
    if best > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [a, b]


def rounded(c):
    return [round(c[0], 5), round(c[1], 5)]


def dump(obj, name):
    path = os.path.join(DST, name)
    with open(path, 'w') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{name}: {os.path.getsize(path) // 1024} КБ')


def railways():
    src = json.load(open(os.path.join(SRC, 'railways.geojson')))
    out = []
    for f in src['features']:
        p, g = f['properties'], f['geometry']
        if g['type'] == 'Point':
            geom = {'type': 'Point', 'coordinates': rounded(g['coordinates'])}
        elif g['type'] == 'LineString':
            geom = {'type': 'LineString',
                    'coordinates': rdp([rounded(c) for c in g['coordinates']], 0.00004)}
        elif g['type'] == 'MultiLineString':
            geom = {'type': 'MultiLineString',
                    'coordinates': [rdp([rounded(c) for c in line], 0.00004)
                                    for line in g['coordinates']]}
        else:
            continue
        props = {'kind': p['kind']}
        if p['kind'] == 'station':
            props['name'] = p.get('name')
            props['major'] = p.get('subclass') == 'station'
        out.append({'type': 'Feature', 'properties': props, 'geometry': geom})
    dump({'type': 'FeatureCollection', 'features': out}, 'railways.geojson')


def caves():
    src = json.load(open(os.path.join(SRC, 'caves.geojson')))
    out = []
    for f in src['features']:
        p = f['properties']
        props = {'kind': 'cave', 'name': p.get('name')}
        for key, dst in [('name:sr', 'nameSr'), ('ele', 'ele'), ('length', 'length'),
                         ('depth', 'depth'), ('wikipedia', 'wikipedia')]:
            if p.get(key) is not None:
                props[dst] = p[key]
        if p.get('fee') == 'yes':
            props['fee'] = True
        lon, lat = f['geometry']['coordinates'][:2]
        out.append({'type': 'Feature', 'properties': props,
                    'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]}})
    dump({'type': 'FeatureCollection', 'features': out}, 'caves.geojson')


if __name__ == '__main__':
    railways()
    caves()
    shutil.copy(os.path.join(SRC, 'histmap_coverage.geojson'), DST)
    print('histmap_coverage.geojson: скопирован')
