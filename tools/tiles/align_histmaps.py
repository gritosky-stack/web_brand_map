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

from histmap_io import Sheet, blur, correlate_shift, orient_field, read_dem_window

STEP = 2                 # прореживание листа: 4.5 м/px × 2 ≈ 9 м/px
BLOCKS_X, BLOCKS_Y = 8, 5
MIN_SHARPNESS = 4.0      # блоки ищут остаток в узком окне, поэтому порог мягкий
MIN_GLOBAL_SHARPNESS = 5.0   # а вот сдвиг всего листа обязан быть уверенным
MAX_SHIFT_M = 1200.0     # больше — это не невязка, а промах поиска пика
MIN_MARGIN = 1.35        # во столько раз пик обязан обойти второй максимум
PRIOR_M = 350.0          # в каком радиусе от ответа соседей искать двойника
RESCUE_M = 250.0         # и в каком — перебирать разошедшийся лист
ACCEPT_M = 120.0         # ближе этого к ответу соседей переисканный замер годен
OUTLIER_M = 200.0        # дальше этого от соседей замер считаем ложным пиком
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


def dem_signals(sheet, shape, step, dem_dir):
    """Рельеф в сетке листа как эталон для печати. Пусто, если DEM нет.

    Возвращает два признака. **Кривизна** — куда гравёр сгущает штрих (гребни
    и тальвеги). **Ориентация склона** — куда он этот штрих ведёт. Второй
    признак важнее: он работает и там, где штрих сплошной и по плотности
    отличить ничего нельзя.
    """
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
    # 14.5x против 10.5x при том же ответе).
    curv = (np.gradient(np.gradient(dem, axis=0), axis=0)
            + np.gradient(np.gradient(dem, axis=1), axis=1))
    curv = np.clip(np.abs(curv), 0, np.percentile(np.abs(curv), 99))
    gy, gx = np.gradient(blur(dem, k=2, rep=2))
    return {"curv": curv, "orient": orient_field(gx, gy)}


# --- признаки на скане -------------------------------------------------------

def ink_signals(img):
    """Что можно снять со скана.

    Набор LoC для Сербии почти весь монохромный: цветные тиражи нашлись лишь
    у 6 листов из 71, и у остальных позиций цветных изданий не существует
    вовсе. Поэтому цветоделение — бонус там, где оно есть, а нести замер
    обязан монохромный признак.

    Просто «тёмные пиксели» не годятся: у сепийного скана есть собственный
    тональный дрейф, и корреляция цепляется за него, а не за печать. Снимаем
    его вычитанием сильно размытой копии — остаются штрихи.

    Из штрихов берём два разных признака. **Плотность** — сколько печати на
    единицу площади. **Ориентация** — куда печать направлена; она и оказалась
    главной, потому что не насыщается (см. `orient_field`).
    """
    r = img[:, :, 0].astype(np.int16)
    g = img[:, :, 1].astype(np.int16)
    b = img[:, :, 2].astype(np.int16)
    lum = (r * 0.3 + g * 0.59 + b * 0.11).astype(np.float32)
    high = lum - blur(lum, k=12, rep=3)           # без тонального дрейфа скана
    lines = (high < -6).astype(np.float32)
    gy, gx = np.gradient(high)

    out = {"lines": lines, "orient": orient_field(gx, gy)}
    blue = ((b - r > 18) & (b - g > 6)).astype(np.float32)
    if blue.mean() > 0.003:                      # цветной тираж
        out["blue"] = blue
    return out


# --- замер -------------------------------------------------------------------

def _pairs(signals, water, relief, sign):
    """Пары «признак на скане ↔ современный эталон».

    Пары «вся печать ↔ реки» здесь намеренно нет, хотя она и даёт иногда
    красивый пик. На монохромном листе печать — это в основном штриховка
    склонов, а штриховка тальвеги как раз обходит: корреляция с гидрографией
    там отрицательная по смыслу, и любой её положительный пик случаен.
    Проверка на листе Дивчибаре это подтвердила — «гидро» тянула ответ
    на 580 м в сторону от того, что показывал рельеф.

    `sign` разводит два тиража. На штриховом листе штрих идёт по линии
    падения, и ориентация печати совпадает с ориентацией градиента рельефа
    (`sign = +1`). На листе с горизонталями линия идёт поперёк склона, и то же
    поле надо развернуть (`sign = -1`). Какой перед нами тираж, из метаданных
    LoC не видно — определяем по тому, какой знак даёт более резкий пик.
    """
    out = []
    if "blue" in signals and water is not None:
        out.append(("реки", signals["blue"], water))
    if relief is not None:
        out.append(("штрих", signals["orient"],
                    tuple(sign * c for c in relief["orient"])))
        out.append(("рельеф", signals["lines"], relief["curv"]))
    return out


def _usable(a, b):
    """Есть ли в паре вообще что коррелировать."""
    aa = a if isinstance(a, tuple) else (a,)
    bb = b if isinstance(b, tuple) else (b,)
    return (max(float(np.abs(x).mean()) for x in aa) > 1e-4
            and max(float(np.std(x)) for x in bb) > 1e-6)


def global_shift(signals, water, relief, radius, centre=(0.0, 0.0), signs=(1.0, -1.0)):
    """Сдвиг всего листа. Считается по всей площади, поэтому устойчив даже там,
    где отдельный блок безнадёжен.

    Возвращает (метка, dx, dy, резкость, отрыв от второго пика, знак).
    """
    best = None
    for sign in signs:
        for label, a, b in _pairs(signals, water, relief, sign):
            if not _usable(a, b):
                continue
            dx, dy, sharp, margin = correlate_shift(a, b, radius=radius, centre=centre)
            if best is None or sharp > best[3]:
                best = (label, dx, dy, sharp, margin, sign)
    return best


def measure(signals, water, relief, mpp_x, mpp_y, base):
    """Поблочная невязка вокруг сдвига листа: (u, v, dE, dN, вес).

    Эталон сдвигаем на уже найденный сдвиг листа и ищем остаток в узком окне.
    Так слабый блок не может «уехать» на километр, поймав случайный пик:
    физически невязка внутри листа меняется плавно.
    """
    ref_shift = (int(round(base[1])), int(round(base[2])))
    sign = base[5]
    h, w = signals["lines"].shape
    bw, bh = w // BLOCKS_X, h // BLOCKS_Y
    local = max(6, int(250 / max(mpp_x, mpp_y)))     # ±250 м вокруг сдвига листа
    out = []
    for j in range(BLOCKS_Y):
        for i in range(BLOCKS_X):
            sy, sx = slice(j * bh, (j + 1) * bh), slice(i * bw, (i + 1) * bw)
            est = []
            for label, a, b in _pairs(signals, water, relief, sign):
                aa = a if isinstance(a, tuple) else (a,)
                bb = b if isinstance(b, tuple) else (b,)
                ablk = tuple(x[sy, sx] for x in aa)
                bblk = tuple(x[sy, sx] for x in bb)
                if not _usable(ablk, bblk):
                    continue
                # сдвигаем скан на сдвиг листа — остаётся только остаток
                shifted = tuple(np.roll(np.roll(x, ref_shift[1], 0), ref_shift[0], 1)
                                for x in ablk)
                dx, dy, sharp, _ = correlate_shift(shifted, bblk, radius=local)
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

def local_field(measured, centers, name, radius_deg=1.2, min_n=3):
    """Ответ соседей в точке листа: медиана по измеренным соседям.

    Медиана, а не среднее: один сосед с ложным пиком не должен утаскивать
    оценку. Радиус берём широким — ошибка георефересовки задаётся датумом и
    тиражом, а они меняются на масштабе куда крупнее листа.
    """
    cx, cy = centers[name]
    near = [v["shift_m"] for n, v in measured.items()
            if n != name
            and (cx - centers[n][0]) ** 2 + (cy - centers[n][1]) ** 2 < radius_deg ** 2]
    if len(near) < min_n:
        near = [v["shift_m"] for n, v in measured.items() if n != name]
        if len(near) < min_n:
            return None
    return (statistics.median(x for x, _ in near),
            statistics.median(y for _, y in near))


def outliers(result, centers, tol=140.0, rounds=3):
    """Листы, чей замер не бьётся с соседями. Пересчитываем в несколько кругов.

    Замер бывает уверенным по резкости пика и всё равно ложным: на листах со
    сплошной штриховкой корреляция цепляется за случайную структуру. Отличить
    такой замер от настоящего по самому листу нельзя — зато видно по соседям.
    Ошибка георефересовки регионально гладкая (её задают датум и тираж, а не
    местность), поэтому лист, разошедшийся с соседями на сотни метров, —
    почти наверняка шум.
    """
    bad = set()
    for _ in range(rounds):
        good = {n: v for n, v in result.items()
                if not v.get("inherited") and n not in bad}
        fresh = set()
        for name, v in good.items():
            loc = local_field(good, centers, name)
            if loc is None:
                continue
            if abs(v["shift_m"][0] - loc[0]) > tol or abs(v["shift_m"][1] - loc[1]) > tol:
                fresh.add(name)
        if not fresh - bad:
            break
        bad |= fresh
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheets_dir")
    ap.add_argument("--dem", default="dem")
    ap.add_argument("--osm-cache", default="osm")
    ap.add_argument("--out", default="align.json")
    ap.add_argument("--grid", type=int, default=5, help="узлов сетки поправки по стороне")
    ap.add_argument("--only", help="один лист по имени — для отладки")
    ap.add_argument("--rescue", action="store_true",
                    help="перебрать по готовому --out листы, разошедшиеся с соседями")
    ap.add_argument("--research", action="store_true",
                    help="при переборе искать пик заново, а не сразу брать поправку соседей")
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.sheets_dir, "*.tif")))
    if args.only:
        paths = [p for p in paths if args.only in p]

    result, report, centers, lat_of = {}, [], {}, {}
    pending, unmeasured = [], []

    def load(path):
        """Лист и всё, с чем его сравнивают, в одной сетке."""
        sheet = Sheet(path)
        img = sheet.downsample(STEP)
        h, w, _ = img.shape
        lat_c = sheet.bbox[1] + (sheet.bbox[3] - sheet.bbox[1]) / 2
        mpp_x = sheet.px * STEP * 111320 * math.cos(math.radians(lat_c))
        mpp_y = sheet.py * STEP * 110570
        signals = ink_signals(img)
        ways = osm_waterways(sheet.bbox, args.osm_cache)
        water = rasterize_ways(ways, sheet, (h, w), STEP) if ways else None
        relief = dem_signals(sheet, (h, w), STEP, args.dem)
        return sheet, signals, water, relief, mpp_x, mpp_y, lat_c

    def record(name, base, signals, water, relief, mpp_x, mpp_y, lat_c):
        """Натянуть сетку поправки по поблочным замерам и сложить в результат."""
        samples = measure(signals, water, relief, mpp_x, mpp_y, base)
        if len(samples) < 3:
            # Лист целиком мерится, а блоки — нет: берём один сдвиг на лист
            samples = [(u, v, base[1] * mpp_x, -base[2] * mpp_y, 1.0)
                       for u in (0.25, 0.75) for v in (0.25, 0.75)]
        gx, gy = fit_grid(samples, args.grid, args.grid)
        res_e, res_n = [], []
        for u, v, dE, dN, _ in samples:
            i_ = min(args.grid - 1, int(u * args.grid))
            j_ = min(args.grid - 1, int(v * args.grid))
            res_e.append(dE - gx[j_, i_])
            res_n.append(dN - gy[j_, i_])
        rms_e = float(np.sqrt(np.mean(np.square(res_e))))
        rms_n = float(np.sqrt(np.mean(np.square(res_n))))
        med_e = float(np.median([s[2] for s in samples]))
        med_n = float(np.median([s[3] for s in samples]))

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
        result[name] = {"grid": args.grid,
                        "dlon": (gx / (111320 * math.cos(math.radians(lat_c)))).tolist(),
                        "dlat": (gy / 110570).tolist(),
                        "blocks": len(samples),
                        "shift_m": [round(med_e, 1), round(med_n, 1)],
                        "raw_shift_m": [round(med_e, 1), round(med_n, 1)],
                        "residual_m": [round(rms_e, 1), round(rms_n, 1)],
                        "signal": base[0],
                        "edition": "штриховой" if base[5] > 0 else "горизонтали",
                        "margin": round(base[4], 2),
                        "warped": warped}
        report.append((name, len(samples), med_e, med_n, (rms_e, rms_n)))
        print(f"[{name}] {base[0]}/{result[name]['edition']}, блоков {len(samples):2d}, "
              f"сдвиг {med_e:+6.0f}/{med_n:+6.0f} м, остаток {rms_e:4.0f}/{rms_n:4.0f} м, "
              f"пик {base[3]:.0f}x (отрыв {base[4]:.1f})", flush=True)

    def flatten(name, dE, dN, lat_c):
        """Один сдвиг на весь лист — когда своего замера у него так и нет."""
        n = args.grid
        result[name] = {"grid": n,
                        "dlon": [[dE / (111320 * math.cos(math.radians(lat_c)))] * n
                                 for _ in range(n)],
                        "dlat": [[dN / 110570] * n for _ in range(n)],
                        "blocks": 0, "shift_m": [round(dE, 1), round(dN, 1)],
                        "residual_m": None, "warped": False, "inherited": True}

    for path in paths:
        name = os.path.basename(path)[:-4]
        box = Sheet(path).bbox
        centers[name] = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        lat_of[name] = (box[1] + box[3]) / 2

    # --- перебор разошедшихся листов по готовому набору ----------------------
    #
    # Отдельный режим, потому что полный замер идёт около часа, а перебирать
    # приходится ровно те листы, где корреляция села на ложный пик, — их видно
    # только когда посчитаны все.
    if args.rescue:
        result.update(json.load(open(args.out, encoding="utf-8")))
        # Замер без отрыва от второго пика в дело не берём. Проверка на шести
        # цветных листах, где есть независимая правда по синей печати рек,
        # показала: там, где отрыв есть, ориентация штриха попадает в эту
        # правду на 3–23 м. Там, где отрыва нет, ответ ничем не лучше жребия —
        # и на юго-востоке такие листы дружно садились на ложный пик около
        # +200 м по востоку.
        weak = {n for n, v in result.items()
                if not v.get("inherited") and (v.get("margin") or 0) < MIN_MARGIN}
        for n in weak:
            result[n]["inherited"] = True
        bad = outliers(result, centers, tol=OUTLIER_M)
        redo = sorted(bad | weak | {n for n, v in result.items() if v.get("inherited")})
        good = {n: v for n, v in result.items()
                if not v.get("inherited") and n not in bad}
        print(f"согласованных листов {len(good)}, перебираем {len(redo)}: "
              + ", ".join(sorted(bad)) if bad else f"согласованы все {len(good)}")
        saved = {n: result[n] for n in good}
        for idx, name in enumerate(redo, 1):
            loc = local_field(saved, centers, name)
            if loc is None:
                continue
            if name in weak or not args.research:
                flatten(name, loc[0], loc[1], lat_of[name])
                continue
            path = os.path.join(args.sheets_dir, f"{name}.tif")
            sheet, signals, water, relief, mpp_x, mpp_y, lat_c = load(path)
            centre = (loc[0] / mpp_x, -loc[1] / mpp_y)
            base = global_shift(signals, water, relief,
                                radius=int(RESCUE_M / mpp_x), centre=centre)
            if base is None or base[3] < MIN_GLOBAL_SHARPNESS:
                flatten(name, loc[0], loc[1], lat_c)
                print(f"[{idx}/{len(redo)}] {name}: сигнала рядом с соседями нет "
                      f"→ поправка соседей {loc[0]:+.0f}/{loc[1]:+.0f} м", flush=True)
                continue
            print(f"[{idx}/{len(redo)}] ", end="")
            record(name, base, signals, water, relief, mpp_x, mpp_y, lat_c)
            # Даже в узком окне пик может сесть не туда: если ответ всё равно
            # далеко от соседей, доверяем соседям, а не ему.
            if (result[name].get("margin", 0) < MIN_MARGIN
                    or abs(result[name]["shift_m"][0] - loc[0]) > ACCEPT_M
                    or abs(result[name]["shift_m"][1] - loc[1]) > ACCEPT_M):
                flatten(name, loc[0], loc[1], lat_c)
                print(f"        …и всё равно мимо — беру поправку соседей "
                      f"{loc[0]:+.0f}/{loc[1]:+.0f} м", flush=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        own = sum(1 for v in result.values() if not v.get("inherited"))
        print(f"\nсвой замер: {own}/{len(result)} листов")
        seam_report(result, centers)
        return

    # --- проход 1: листы, чей пик однозначен ---------------------------------
    #
    # Однозначным считаем тот, что и резкий, и заметно выше второго максимума.
    # Второе условие тут не формальность: у квазипериодической печати
    # корреляция даёт гряду почти равных пиков, и самый высокий из них
    # запросто соответствует сдвигу на шаг штриховки, а не на невязку.
    for idx, path in enumerate(paths, 1):
        name = os.path.basename(path)[:-4]
        sheet, signals, water, relief, mpp_x, mpp_y, lat_c = load(path)
        centers[name] = ((sheet.bbox[0] + sheet.bbox[2]) / 2,
                         (sheet.bbox[1] + sheet.bbox[3]) / 2)
        lat_of[name] = lat_c
        base = global_shift(signals, water, relief, radius=int(MAX_SHIFT_M / mpp_x))
        if base is None or base[3] < MIN_GLOBAL_SHARPNESS:
            print(f"[{idx}/{len(paths)}] {name}: сигнала нет"
                  + (f" (пик {base[3]:.1f}x)" if base else ""), flush=True)
            unmeasured.append(name)
            continue
        if base[4] < MIN_MARGIN:
            print(f"[{idx}/{len(paths)}] {name}: пик {base[3]:.0f}x, но двойник рядом "
                  f"(отрыв {base[4]:.2f}) — доищем по соседям", flush=True)
            pending.append((path, name))
            continue
        print(f"[{idx}/{len(paths)}] ", end="")
        record(name, base, signals, water, relief, mpp_x, mpp_y, lat_c)

    # --- опорное поле --------------------------------------------------------
    def prior(name):
        """Ответ соседей, взвешенный обратным квадратом расстояния."""
        cx, cy = centers[name]
        num_e = num_n = den = 0.0
        for on, v in result.items():
            if v.get("inherited"):
                continue
            d2 = (cx - centers[on][0]) ** 2 + (cy - centers[on][1]) ** 2
            wgt = 1.0 / (d2 + 0.02)
            num_e += wgt * v["shift_m"][0]
            num_n += wgt * v["shift_m"][1]
            den += wgt
        return (num_e / den, num_n / den) if den else None

    # --- проход 2: доискиваем двойников рядом с ответом соседей --------------
    for path, name in pending:
        p = prior(name)
        if p is None:
            unmeasured.append(name)
            continue
        sheet, signals, water, relief, mpp_x, mpp_y, lat_c = load(path)
        centre = (p[0] / mpp_x, -p[1] / mpp_y)
        base = global_shift(signals, water, relief,
                            radius=int(PRIOR_M / mpp_x), centre=centre)
        if base is None or base[3] < MIN_GLOBAL_SHARPNESS:
            print(f"[доп] {name}: и рядом с соседями сигнала нет", flush=True)
            unmeasured.append(name)
            continue
        print(f"[доп] ", end="")
        record(name, base, signals, water, relief, mpp_x, mpp_y, lat_c)

    # Листы, где сигнала нет вовсе, получают поправку соседей: она заведомо
    # неточная, зато гладкая — шва на стыке от неё не будет.
    measured = {n: v for n, v in result.items() if not v.get("inherited")}
    for name in unmeasured:
        loc = local_field(measured, centers, name) or (0.0, 0.0)
        flatten(name, loc[0], loc[1], lat_of[name])

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    own = [n for n, v in result.items() if not v.get("inherited")]
    print(f"\nсвой замер: {len(own)}/{len(result)} листов")
    good = [r for r in report if r[0] in own]
    if good:
        print("сдвиг, медиана по листам: "
              f"E {np.median([r[2] for r in good]):+.0f} м, "
              f"N {np.median([r[3] for r in good]):+.0f} м")
        print("остаточная невязка, медиана: "
              f"E {np.median([r[4][0] for r in good]):.0f} м, "
              f"N {np.median([r[4][1] for r in good]):.0f} м")
    seam_report(result, centers)
    print("дальше: тот же вызов с --rescue — он переберёт разошедшиеся листы")


def seam_report(result, centers):
    """Приёмка стыков: соседние листы обязаны сойтись, иначе на карте виден шов.

    Метрика лукавая сама по себе — набор, где все листы получили одну и ту же
    поправку соседей, покажет идеальные стыки и при этом будет весь сдвинут.
    Поэтому смотреть на неё имеет смысл только вместе с числом листов, у
    которых есть собственный замер.
    """
    seams = []
    for a in result:
        for b in result:
            if a >= b:
                continue
            d = math.hypot(centers[a][0] - centers[b][0], centers[a][1] - centers[b][1])
            if d > 0.55:
                continue
            seams.append((math.hypot(result[a]["shift_m"][0] - result[b]["shift_m"][0],
                                     result[a]["shift_m"][1] - result[b]["shift_m"][1]), a, b))
    if not seams:
        return
    seams.sort(reverse=True)
    vals = [s[0] for s in seams]
    print(f"расхождение на стыках: медиана {statistics.median(vals):.0f} м, "
          f"хуже 150 м — {sum(1 for v in vals if v > 150)} из {len(vals)}; "
          + "худшие: " + ", ".join(f"{a}/{b} {g:.0f} м" for g, a, b in seams[:3]))


if __name__ == "__main__":
    main()
