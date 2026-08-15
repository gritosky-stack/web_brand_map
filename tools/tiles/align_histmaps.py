#!/usr/bin/env python3
"""Посадка листов «Спецкарты» на современные координаты.

Георефересовка LoC систематически промахивается. Природа промаха известна:

* **Датум.** Оригинал снят на эллипсоиде Бесселя (MGI 1901, Hermannskogel),
  а градусная сетка листа посажена как WGS84. В Сербии это −422 м по восточной
  оси (проверено через pyproj).
* **Проекция.** «Спецкарта» полиэдрическая: лист на бумаге — трапеция, верхняя
  рамка короче нижней на cos(φ_верх)/cos(φ_низ) ≈ 0.4%. Прямоугольная аффинка
  такую форму передать не может в принципе.
* **Бумага.** Печать, век хранения и скан дают неравномерную усадку — до
  сотых долей процента по каждой оси отдельно.

Казалось бы, первые два можно посчитать начисто и не подгонять ничего. Нельзя:
георефересовка LoC эмпирическая, и **часть датумного сдвига она уже вобрала** —
из −422 м на Ваљево остаётся −126 м. Сколько именно вобрано, из данных LoC не
восстановить. Поэтому поправку **измеряем**, а перечисленное выше служит
проверкой правдоподобия: сдвиг в сотни метров по долготе — ожидаемая физика,
а не признак сломанного замера.

Меряем по двум независимым признакам, которые на карте напечатаны разным цветом:

* синяя печать (реки) — против гидрографии OpenStreetMap;
* коричневая (горизонтали и штриховка) — против крутизны склонов Copernicus DEM.

Оба — кросс-корреляцией через FFT. Реки дают резкий пик, но плохо держат
положение вдоль долины; рельеф держит обе оси. Вместе они закрывают слабости
друг друга.

Модель поправки — сетка смещений на лист (не аффинка): так одинаково
выражаются и сдвиг, и масштаб, и перекос, и остаточная деформация бумаги.
Сетка получается сглаживанием поблочных замеров, поэтому она снимает
деформацию листа, но не гоняется за отдельными реками: русло, реально
сменившееся за сто лет, останется там, где его нарисовали.

    python align_histmaps.py sheets/ --dem dem/ --out align.json
"""
import argparse
import glob
import json
import math
import os
import statistics
import time
import urllib.error
import urllib.request

import numpy as np

from histmap_io import Sheet, blur, correlate_shift, read_dem_window

STEP = 2                 # прореживание листа: 4.5 м/px × 2 ≈ 9 м/px
BLOCKS_X, BLOCKS_Y = 8, 5
MIN_SHARPNESS = 4.0      # блоки ищут остаток в узком окне, поэтому порог мягкий
MIN_GLOBAL_SHARPNESS = 5.0   # а вот сдвиг всего листа обязан быть уверенным
MAX_SHIFT_M = 1200.0     # больше — это не невязка, а промах поиска пика
OVERPASS = "https://overpass-api.de/api/interpreter"


# --- современные данные ------------------------------------------------------

def osm_waterways(bbox, cache_dir, delay=1.5):
    """Реки и ручьи OSM в bbox. Кэшируем: Overpass медленный и не любит спешку."""
    os.makedirs(cache_dir, exist_ok=True)
    key = "_".join(f"{v:.3f}" for v in bbox)
    path = os.path.join(cache_dir, f"{key}.json")
    if os.path.exists(path):
        return json.load(open(path))["elements"]

    query = (f'[out:json][timeout:180];'
             f'(way["waterway"~"^(river|stream|canal)$"]'
             f'({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}););out geom;')
    for attempt in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=query.encode(),
                                         headers={"User-Agent": "totskii-wild-tiles/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = json.loads(r.read())
            break
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                print(f"    Overpass не ответил: {exc}", flush=True)
                return []
            time.sleep(8 * (attempt + 1))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    time.sleep(delay)
    return data["elements"]


def rasterize_ways(ways, sheet, shape, step):
    """Линии OSM → маска в сетке листа. Реки весомее ручьёв: они и шире, и стабильнее."""
    h, w = shape
    out = np.zeros(shape, np.float32)
    for way in ways:
        weight = 2.0 if way.get("tags", {}).get("waterway") == "river" else 1.0
        pts = [sheet.px_of(p["lon"], p["lat"]) for p in way.get("geometry") or []]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            x1, y1, x2, y2 = x1 / step, y1 / step, x2 / step, y2 / step
            n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
            if n > 4000:
                continue
            for t in np.linspace(0, 1, n):
                xi, yi = int(x1 + (x2 - x1) * t), int(y1 + (y2 - y1) * t)
                if 0 <= xi < w and 0 <= yi < h:
                    out[yi, xi] = weight
    return out


def dem_relief(sheet, shape, step, dem_dir):
    """Рельеф в сетке листа как эталон для печати. Пусто, если DEM нет."""
    h, w = shape
    lon0, lat0, lon1, lat1 = sheet.bbox
    dem = np.full(shape, np.nan, np.float32)
    lons = lon0 + (np.arange(w) + 0.5) * sheet.px * step
    lats = lat1 - (np.arange(h) + 0.5) * sheet.py * step
    for path in sorted(glob.glob(os.path.join(dem_dir, "*.tif"))):
        res = read_dem_window(path, lon0, lat0, lon1, lat1)
        if not res:
            continue
        a, dlon, dlat, dstep = res
        xs = ((lons - dlon) / dstep).astype(int)
        ys = ((dlat - lats) / dstep).astype(int)
        okx, oky = (xs >= 0) & (xs < a.shape[1]), (ys >= 0) & (ys < a.shape[0])
        if not okx.any() or not oky.any():
            continue
        sub = a[np.clip(ys, 0, a.shape[0] - 1)][:, np.clip(xs, 0, a.shape[1] - 1)]
        mask = np.outer(oky, okx) & np.isfinite(sub)
        dem[mask] = sub[mask]
    if not np.isfinite(dem).any():
        return None
    dem = np.nan_to_num(dem, nan=float(np.nanmedian(dem)))
    # Кривизна, а не уклон: гравёр сгущает штрих на перегибах — по гребням и
    # тальвегам, — и с ней пик корреляции заметно резче (на проверочном листе
    # 14.5× против 10.5× при том же ответе).
    curv = (np.gradient(np.gradient(dem, axis=0), axis=0)
            + np.gradient(np.gradient(dem, axis=1), axis=1))
    curv = np.abs(curv)
    return np.clip(curv, 0, np.percentile(curv, 99))


# --- признаки на скане -------------------------------------------------------

def ink_signals(img):
    """Что можно снять со скана.

    Набор LoC для Сербии почти весь монохромный: цветные тиражи нашлись лишь
    у 8 листов из 71, и у остальных позиций цветных изданий не существует
    вовсе. Поэтому основной признак — **плотность линий**, а цветоделение идёт
    бонусом там, где оно есть.

    Просто «тёмные пиксели» не годятся: у сепийного скана есть собственный
    тональный дрейф, и корреляция цепляется за него, а не за печать. Снимаем
    его вычитанием сильно размытой копии — остаются штрихи.
    """
    r = img[:, :, 0].astype(np.int16)
    g = img[:, :, 1].astype(np.int16)
    b = img[:, :, 2].astype(np.int16)
    lum = (r * 0.3 + g * 0.59 + b * 0.11).astype(np.float32)
    lines = (lum - blur(lum, k=12, rep=3) < -6).astype(np.float32)

    out = {"lines": lines}
    blue = ((b - r > 18) & (b - g > 6)).astype(np.float32)
    if blue.mean() > 0.003:                      # цветной тираж
        out["blue"] = blue
    return out


# --- замер -------------------------------------------------------------------

def _pairs(signals, water, relief):
    """Пары «признак на скане ↔ современный эталон».

    Пары «вся печать ↔ реки» здесь намеренно нет, хотя она и даёт иногда
    красивый пик. На монохромном листе печать — это в основном штриховка
    склонов, а штриховка тальвеги как раз обходит: корреляция с гидрографией
    там отрицательная по смыслу, и любой её положительный пик случаен.
    Проверка на листе Дивчибаре это подтвердила — «гидро» тянула ответ
    на 580 м в сторону от того, что показывал рельеф.
    """
    out = []
    if "blue" in signals and water is not None:
        out.append(("реки", signals["blue"], water))
    if relief is not None:
        out.append(("рельеф", signals["lines"], relief))
    return out


def global_shift(signals, water, relief, radius):
    """Сдвиг всего листа. Считается по всей площади, поэтому устойчив даже там,
    где отдельный блок безнадёжен."""
    best = None
    for label, a, b in _pairs(signals, water, relief):
        if a.mean() < 0.002 or float(np.std(b)) < 1e-6:
            continue
        dx, dy, sharp = correlate_shift(a, b, radius=radius)
        if best is None or sharp > best[3]:
            best = (label, dx, dy, sharp)
    return best


def measure(signals, water, relief, mpp_x, mpp_y, base):
    """Поблочная невязка вокруг сдвига листа: (u, v, dE, dN, вес).

    Эталон сдвигаем на уже найденный сдвиг листа и ищем остаток в узком окне.
    Так слабый блок не может «уехать» на километр, поймав случайный пик:
    физически невязка внутри листа меняется плавно.
    """
    ref_shift = (int(round(base[1])), int(round(base[2])))
    h, w = signals["lines"].shape
    bw, bh = w // BLOCKS_X, h // BLOCKS_Y
    local = max(6, int(250 / max(mpp_x, mpp_y)))     # ±250 м вокруг сдвига листа
    out = []
    for j in range(BLOCKS_Y):
        for i in range(BLOCKS_X):
            sy, sx = slice(j * bh, (j + 1) * bh), slice(i * bw, (i + 1) * bw)
            est = []
            for label, a, b in _pairs(signals, water, relief):
                ablk = a[sy, sx]
                bblk = b[sy, sx]
                if ablk.mean() < 0.004 or float(np.std(bblk)) < 1e-6:
                    continue
                # сдвигаем скан на сдвиг листа — остаётся только остаток
                shifted = np.roll(np.roll(ablk, ref_shift[1], 0), ref_shift[0], 1)
                dx, dy, sharp = correlate_shift(shifted, bblk, radius=local)
                if sharp >= MIN_SHARPNESS:
                    est.append((dx + base[1], dy + base[2], sharp))
            if not est:
                continue
            wt = sum(min(e[2] / MIN_SHARPNESS, 3.0) for e in est)
            dx = sum(e[0] * min(e[2] / MIN_SHARPNESS, 3.0) for e in est) / wt
            dy = sum(e[1] * min(e[2] / MIN_SHARPNESS, 3.0) for e in est) / wt
            dE, dN = dx * mpp_x, -dy * mpp_y
            if math.hypot(dE, dN) > MAX_SHIFT_M:
                continue
            out.append(((i + 0.5) / BLOCKS_X, (j + 0.5) / BLOCKS_Y, dE, dN, wt))
    return out


def fit_grid(samples, nx, ny):
    """Поблочные замеры → гладкая сетка смещений.

    Сначала взвешенная плоскость (сдвиг + масштаб + перекос) — она берёт на себя
    физику: датум, растяжение листа, перекос скана. Потом к ней добавляется
    остаток, размазанный обратно-квадратичным весом. Радиус размазывания взят
    большим намеренно: он должен передавать деформацию листа и гасить шум
    отдельного блока, а не подтягивать карту к каждой реке.
    """
    u = np.array([s[0] for s in samples])
    v = np.array([s[1] for s in samples])
    wt = np.array([s[4] for s in samples])
    grids = []
    gu, gv = np.meshgrid((np.arange(nx) + 0.5) / nx, (np.arange(ny) + 0.5) / ny)
    for comp in (2, 3):
        d = np.array([s[comp] for s in samples])
        A = np.stack([np.ones_like(u), u, v], axis=1)
        W = np.sqrt(wt)[:, None]
        coef, *_ = np.linalg.lstsq(A * W, d * W[:, 0], rcond=None)
        plane = coef[0] + coef[1] * gu + coef[2] * gv
        resid = d - (coef[0] + coef[1] * u + coef[2] * v)
        if len(samples) >= 8:
            num = np.zeros_like(plane)
            den = np.zeros_like(plane)
            for k in range(len(u)):
                dist2 = (gu - u[k]) ** 2 + (gv - v[k]) ** 2
                weight = wt[k] / (dist2 + 0.09)       # 0.09 ≈ (0.3 листа)²
                num += weight * resid[k]
                den += weight
            plane = plane + num / den
        grids.append(plane)
    return grids



# --- отбраковка по соседям --------------------------------------------------

CONSISTENCY_M = 250.0     # дальше этого от соседей замер считается шумом
NEIGHBOUR_DEG = 1.2       # радиус «соседства» в градусах


def refit(result, centers, lat_of):
    """Оставить только замеры, согласованные с соседями; остальным — их поправка.

    Замер бывает уверенным по резкости пика и всё равно ложным: на листах со
    сплошной штриховкой корреляция цепляется за случайную структуру. Отличить
    такой замер от настоящего по самому листу нельзя — зато видно по соседям.
    Ошибка георефересовки регионально гладкая (её задают датум и тираж, а не
    местность), поэтому лист, разошедшийся с соседями на сотни метров, —
    почти наверняка шум.

    Проверка идёт в два прохода: первый выбивает грубые выбросы, второй
    пересчитывает медианы уже без них.
    """
    def measured():
        return {n: v for n, v in result.items()
                if not v.get("inherited") and not v.get("rejected")}

    for _ in range(2):
        good = measured()
        for name, v in list(good.items()):
            cx, cy = centers[name]
            near = [o["shift_m"] for on, o in good.items()
                    if on != name
                    and (cx - centers[on][0]) ** 2 + (cy - centers[on][1]) ** 2 < NEIGHBOUR_DEG ** 2]
            if len(near) < 3:
                continue
            med_e = statistics.median(x for x, _ in near)
            med_n = statistics.median(y for _, y in near)
            if (abs(v["shift_m"][0] - med_e) > CONSISTENCY_M
                    or abs(v["shift_m"][1] - med_n) > CONSISTENCY_M):
                v["rejected"] = True

    # Всем, у кого нет своего замера, — поправка соседей по обратному квадрату
    good = measured()
    if not good:
        return result
    for name, v in result.items():
        if name in good:
            continue
        cx, cy = centers[name]
        num_e = num_n = den = 0.0
        for on, o in good.items():
            d2 = (cx - centers[on][0]) ** 2 + (cy - centers[on][1]) ** 2
            wgt = 1.0 / (d2 + 0.02)
            num_e += wgt * o["shift_m"][0]
            num_n += wgt * o["shift_m"][1]
            den += wgt
        dE, dN = num_e / den, num_n / den
        n = v["grid"]
        lat_c = lat_of[name]
        v["dlon"] = [[dE / (111320 * math.cos(math.radians(lat_c)))] * n for _ in range(n)]
        v["dlat"] = [[dN / 110570] * n for _ in range(n)]
        v["shift_m"] = [round(dE, 1), round(dN, 1)]
        v["inherited"] = True
        v["warped"] = False
        v.pop("rejected", None)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheets_dir")
    ap.add_argument("--dem", default="dem")
    ap.add_argument("--osm-cache", default="osm")
    ap.add_argument("--out", default="align.json")
    ap.add_argument("--grid", type=int, default=5, help="узлов сетки поправки по стороне")
    ap.add_argument("--only", help="один лист по имени — для отладки")
    ap.add_argument("--refit", action="store_true",
                    help="пересчитать отбраковку по готовому --out, не измеряя заново")
    args = ap.parse_args()

    if args.refit:
        result = json.load(open(args.out, encoding="utf-8"))
        centers, lat_of = {}, {}
        for name in result:
            box = Sheet(os.path.join(args.sheets_dir, f"{name}.tif")).bbox
            centers[name] = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
            lat_of[name] = (box[1] + box[3]) / 2
            result[name].pop("rejected", None)
        refit(result, centers, lat_of)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        own = sum(1 for v in result.values() if not v.get("inherited"))
        print(f"после отбраковки: свой замер у {own} листов, "
              f"у остальных {len(result) - own} — поправка соседей")
        return

    paths = sorted(glob.glob(os.path.join(args.sheets_dir, "*.tif")))
    if args.only:
        paths = [p for p in paths if args.only in p]
    result, report, centers, unmeasured, lat_of = {}, [], {}, [], {}

    for idx, path in enumerate(paths, 1):
        name = os.path.basename(path)[:-4]
        sheet = Sheet(path)
        img = sheet.downsample(STEP)
        h, w, _ = img.shape
        lat_c = sheet.bbox[1] + (sheet.bbox[3] - sheet.bbox[1]) / 2
        mpp_x = sheet.px * STEP * 111320 * math.cos(math.radians(lat_c))
        mpp_y = sheet.py * STEP * 110570

        signals = ink_signals(img)
        ways = osm_waterways(sheet.bbox, args.osm_cache)
        water = rasterize_ways(ways, sheet, (h, w), STEP) if ways else None
        relief = dem_relief(sheet, (h, w), STEP, args.dem)

        base = global_shift(signals, water, relief, radius=int(MAX_SHIFT_M / mpp_x))
        if base is None or base[3] < MIN_GLOBAL_SHARPNESS:
            report.append((name, 0, None, None, None))
            unmeasured.append((name, (sheet.bbox[0] + sheet.bbox[2]) / 2,
                               (sheet.bbox[1] + sheet.bbox[3]) / 2, lat_c))
            print(f"[{idx}/{len(paths)}] {name}: сигнала нет"
                  + (f" (пик {base[3]:.1f}x)" if base else ""), flush=True)
            continue

        samples = measure(signals, water, relief, mpp_x, mpp_y, base)
        if len(samples) < 3:
            # Лист целиком мерится, а блоки — нет: берём один сдвиг на лист
            samples = [(u, v, base[1] * mpp_x, -base[2] * mpp_y, 1.0)
                       for u in (0.25, 0.75) for v in (0.25, 0.75)]

        gx, gy = fit_grid(samples, args.grid, args.grid)
        # Остаточная невязка: насколько замеры расходятся с натянутой сеткой
        res_e, res_n = [], []
        for u, v, dE, dN, _ in samples:
            i = min(args.grid - 1, int(u * args.grid))
            j = min(args.grid - 1, int(v * args.grid))
            res_e.append(dE - gx[j, i])
            res_n.append(dN - gy[j, i])
        rms_e = float(np.sqrt(np.mean(np.square(res_e))))
        rms_n = float(np.sqrt(np.mean(np.square(res_n))))
        med_e, med_n = float(np.median([s[2] for s in samples])), float(np.median([s[3] for s in samples]))

        # Шумный лист не варпим: если замеры расходятся с натянутой сеткой
        # сильнее полусотни метров, значит сетка описывает не деформацию листа,
        # а разброс самих замеров — и, натянув её, мы бы вносили в карту
        # искажения собственного изготовления. Такому листу даём один сдвиг.
        if max(rms_e, rms_n) > 80:
            gx = np.full_like(gx, med_e)
            gy = np.full_like(gy, med_n)
            warped = False
        else:
            warped = True

        # Сетку храним в градусах: тайлеру не нужно знать про метры
        dlon = (gx / (111320 * math.cos(math.radians(lat_c)))).tolist()
        dlat = (gy / 110570).tolist()
        centers[name] = ((sheet.bbox[0] + sheet.bbox[2]) / 2,
                         (sheet.bbox[1] + sheet.bbox[3]) / 2)
        lat_of[name] = lat_c
        result[name] = {"grid": args.grid, "dlon": dlon, "dlat": dlat,
                        "blocks": len(samples),
                        "shift_m": [round(med_e, 1), round(med_n, 1)],
                        "residual_m": [round(rms_e, 1), round(rms_n, 1)],
                        "warped": warped}
        report.append((name, len(samples), med_e, med_n, (rms_e, rms_n)))
        print(f"[{idx}/{len(paths)}] {name}: {base[0]}, блоков {len(samples):2d}, "
              f"сдвиг {med_e:+6.0f}/{med_n:+6.0f} м, остаток {rms_e:4.0f}/{rms_n:4.0f} м",
              flush=True)

    # Листы без сигнала (сплошная штриховка южных тиражей не несёт информации
    # о крутизне) и листы, разошедшиеся с соседями, получают поправку соседей.
    for name, cx, cy, lat_c in unmeasured:
        centers[name] = (cx, cy)
        lat_of[name] = lat_c
        result[name] = {"grid": args.grid,
                        "dlon": [[0.0] * args.grid for _ in range(args.grid)],
                        "dlat": [[0.0] * args.grid for _ in range(args.grid)],
                        "blocks": 0, "shift_m": [0.0, 0.0],
                        "residual_m": None, "inherited": True}
    refit(result, centers, lat_of)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    good = [r for r in report if r[4]]
    if good:
        print(f"\nвыровнено листов: {len(good)}/{len(report)}")
        print("сдвиг, медиана по листам: "
              f"E {np.median([r[2] for r in good]):+.0f} м, "
              f"N {np.median([r[3] for r in good]):+.0f} м")
        print("остаточная невязка, медиана: "
              f"E {np.median([r[4][0] for r in good]):.0f} м, "
              f"N {np.median([r[4][1] for r in good]):.0f} м")
        worst = sorted(good, key=lambda r: -max(r[4]))[:5]
        print("худшие листы: " + ", ".join(f"{r[0]} ({max(r[4]):.0f} м)" for r in worst))
    missing = [n for n, *_ in unmeasured if n not in result]
    if missing:
        print(f"остались на георефересовке LoC ({len(missing)}): {', '.join(missing)}")


if __name__ == "__main__":
    main()
