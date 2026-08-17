#!/usr/bin/env python3
"""Чтение растров без GDAL: сканы «Спецкарты» и Copernicus DEM.

`rasterio` тут не годится: колёс под свежий Python нет, а собирать GDAL из
исходников на Ventura — часы (об этом же в README). Оба формата, которые нам
нужны, простые, и читать их напрямую дешевле, чем тащить зависимость:

* лист LoC — несжатый RGB, `RowsPerStrip=1`, то есть строка = один seek;
* Copernicus GLO-30 — COG: тайлы 1024×1024, float32, deflate + предиктор 3.

Предиктор 3 («с плавающей точкой») хранит байтовые плоскости раздельно и с
горизонтальной разностью: сначала накапливаем разности по строке, потом
собираем байты обратно в float. Порядок плоскостей — от старшего байта.
"""
import struct
import zlib

import numpy as np

_TYPES = {1: ("B", 1), 2: ("c", 1), 3: ("H", 2), 4: ("I", 4), 5: ("II", 8),
          11: ("f", 4), 12: ("d", 8), 16: ("Q", 8)}


def read_tags(f):
    """Теги первого IFD. BigTIFF не поддерживаем — в обоих наборах его нет."""
    head = f.read(8)
    bo = "<" if head[:2] == b"II" else ">"
    if struct.unpack(bo + "H", head[2:4])[0] != 42:
        raise ValueError("ожидался классический TIFF")
    f.seek(struct.unpack(bo + "I", head[4:8])[0])
    count = struct.unpack(bo + "H", f.read(2))[0]
    raw = f.read(count * 12)
    tags = {}
    for i in range(count):
        tag, typ, cnt = struct.unpack(bo + "HHI", raw[i * 12:i * 12 + 8])
        val = raw[i * 12 + 8:i * 12 + 12]
        if typ not in _TYPES:
            continue
        fmt, size = _TYPES[typ]
        total = size * cnt
        if total <= 4:
            data = val[:total]
        else:
            off = struct.unpack(bo + "I", val)[0]
            here = f.tell()
            f.seek(off)
            data = f.read(total)
            f.seek(here)
        if typ == 2:
            tags[tag] = data.decode("latin1").rstrip("\0")
        elif typ == 5:
            tags[tag] = [struct.unpack(bo + "II", data[j * 8:j * 8 + 8]) for j in range(cnt)]
        else:
            tags[tag] = list(struct.unpack(bo + fmt * cnt, data))
    return tags, bo


class Sheet:
    """Лист «Спецкарты»: RGB + аффинка EPSG:4326 (north-up, без поворота)."""

    def __init__(self, path):
        self.f = open(path, "rb")
        tags, _ = read_tags(self.f)
        self.width, self.height = tags[256][0], tags[257][0]
        self.strips = tags[273]
        if tags.get(259, [1])[0] != 1 or tags.get(278, [1])[0] != 1:
            raise ValueError("ожидался несжатый TIFF с RowsPerStrip=1")
        scale, tie = tags[33550], tags[33922]
        self.px, self.py = scale[0], scale[1]
        self.lon0, self.lat0 = tie[3], tie[4]      # верхний левый угол
        self.dlon = self.dlat = 0.0                # поправка георефересовки

    @property
    def bbox(self):
        return (self.lon0 + self.dlon,
                self.lat0 + self.dlat - self.height * self.py,
                self.lon0 + self.dlon + self.width * self.px,
                self.lat0 + self.dlat)

    def row(self, y):
        self.f.seek(self.strips[y])
        return np.frombuffer(self.f.read(self.width * 3), np.uint8).reshape(self.width, 3)

    def downsample(self, step):
        """Прореженная копия листа — для замера невязки, не для нарезки."""
        ys = range(0, self.height, step)
        out = np.empty((len(ys), len(range(0, self.width, step)), 3), np.uint8)
        for i, y in enumerate(ys):
            out[i] = self.row(y)[::step]
        return out

    def read_rows(self, y0, y1):
        """Полосa строк [y0, y1) целиком — так нарезка читает лист один раз."""
        y0, y1 = max(0, y0), min(self.height, y1)
        out = np.empty((y1 - y0, self.width, 3), np.uint8)
        for i, y in enumerate(range(y0, y1)):
            out[i] = self.row(y)
        return out

    def px_of(self, lon, lat):
        """Координаты → дробный пиксель листа (с учётом поправки)."""
        return ((lon - self.lon0 - self.dlon) / self.px,
                (self.lat0 + self.dlat - lat) / self.py)


def read_dem_window(path, lon0, lat0, lon1, lat1):
    """Окно из Copernicus COG: (высоты, lon левого края, lat верхнего, шаг)."""
    with open(path, "rb") as f:
        tags, _ = read_tags(f)
        width, height = tags[256][0], tags[257][0]
        tw, th = tags[322][0], tags[323][0]
        ox, oy = tags[33922][3], tags[33922][4]
        step = tags[33550][0]
        if tags.get(259, [1])[0] != 8 or tags.get(317, [1])[0] != 3:
            raise ValueError("ожидался deflate с предиктором 3")

        x0 = max(0, int((lon0 - ox) / step))
        x1 = min(width, int((lon1 - ox) / step) + 1)
        y0 = max(0, int((oy - lat1) / step))
        y1 = min(height, int((oy - lat0) / step) + 1)
        if x1 <= x0 or y1 <= y0:
            return None

        out = np.full((y1 - y0, x1 - x0), np.nan, np.float32)
        per_row = (width + tw - 1) // tw
        for ty in range(y0 // th, (y1 - 1) // th + 1):
            for tx in range(x0 // tw, (x1 - 1) // tw + 1):
                idx = ty * per_row + tx
                f.seek(tags[324][idx])
                buf = zlib.decompress(f.read(tags[325][idx]))
                a = np.frombuffer(buf, np.uint8).reshape(th, tw * 4).copy()
                np.cumsum(a, axis=1, dtype=np.uint8, out=a)
                a = a.reshape(th, 4, tw).transpose(0, 2, 1)[:, :, ::-1]
                tile = np.ascontiguousarray(a).view("<f4").reshape(th, tw)
                gy, gx = ty * th, tx * tw
                sy0, sx0 = max(y0, gy), max(x0, gx)
                sy1, sx1 = min(y1, gy + th), min(x1, gx + tw)
                out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = \
                    tile[sy0 - gy:sy1 - gy, sx0 - gx:sx1 - gx]
        return out, ox + x0 * step, oy - y0 * step, step


def blur(a, k=3, rep=3):
    """Приближение гауссианы тремя проходами box-фильтра (scipy не нужен)."""
    a = a.astype(np.float32)
    for _ in range(rep):
        c = np.cumsum(np.pad(a, ((0, 0), (k, k))), axis=1)
        a = (c[:, 2 * k:] - c[:, :-2 * k]) / (2 * k)
        c = np.cumsum(np.pad(a, ((k, k), (0, 0))), axis=0)
        a = (c[2 * k:] - c[:-2 * k]) / (2 * k)
    return a


def correlate_shift(a, b, radius, centre=(0.0, 0.0)):
    """Сдвиг, которым `a` садится на `b`: пик кросс-корреляции через FFT.

    `a` и `b` — либо по растру, либо по набору растров: у поля ориентаций две
    компоненты, и корреляции по ним складываются, то есть пик ищется по
    совпадению направления, а не яркости.

    Пик уточняем параболой по трём соседним отсчётам — иначе точность
    упирается в шаг сетки, а он у нас 18 м. `centre` сдвигает окно поиска:
    так лист с неоднозначной корреляцией ищут рядом с ответом соседей.

    Возвращает (dx, dy, резкость пика в медианах, отрыв от второго максимума).
    """
    aa = [a] if isinstance(a, np.ndarray) else list(a)
    bb = [b] if isinstance(b, np.ndarray) else list(b)
    c = None
    for ai, bi in zip(aa, bb):
        ai, bi = blur(ai), blur(bi)
        ai = ai - ai.mean()
        bi = bi - bi.mean()
        part = np.fft.irfft2(np.fft.rfft2(bi) * np.conj(np.fft.rfft2(ai)), s=ai.shape)
        c = part if c is None else c + part
    c = np.fft.fftshift(c)
    h, w = c.shape
    cy0 = h // 2 + int(round(centre[1]))
    cx0 = w // 2 + int(round(centre[0]))
    r = min(radius, cy0 - 2, cx0 - 2, h - cy0 - 2, w - cx0 - 2)
    if r < 3:
        return 0.0, 0.0, 0.0, 1.0
    win = c[cy0 - r:cy0 + r, cx0 - r:cx0 + r]
    cy, cx = np.unravel_index(np.argmax(win), win.shape)
    peak = win[cy, cx]
    sharpness = peak / (np.median(np.abs(c)) + 1e-9)

    # Отрыв от второго максимума. У квазипериодической печати — штриховка,
    # горизонтали — корреляция даёт целую гряду почти равных пиков, и самый
    # высокий из них запросто не тот. Один пик выше остальных — ответ
    # однозначен; несколько сравнимых — лист надо доискивать по соседям.
    rival = np.array(win, copy=True)
    # Гасим не только сам пик, но и всё его плечо: поля перед корреляцией
    # размыты, поэтому пик широкий, и без этого «вторым максимумом» окажется
    # его собственный склон — отрыв выйдет около единицы у любого, даже
    # безупречного замера.
    k = max(4, r // 4)
    rival[max(0, cy - k):cy + k + 1, max(0, cx - k):cx + k + 1] = -np.inf
    second = float(rival.max()) if np.isfinite(rival).any() else 0.0
    margin = float(peak / second) if second > 0 else 99.0

    def refine(prev, cur, nxt):
        d = prev - 2 * cur + nxt
        return 0.0 if abs(d) < 1e-9 else np.clip(0.5 * (prev - nxt) / d, -1, 1)

    sub_x = sub_y = 0.0
    if 0 < cx < win.shape[1] - 1:
        sub_x = refine(win[cy, cx - 1], peak, win[cy, cx + 1])
    if 0 < cy < win.shape[0] - 1:
        sub_y = refine(win[cy - 1, cx], peak, win[cy + 1, cx])
    return (cx - r + sub_x + centre[0], cy - r + sub_y + centre[1],
            float(sharpness), margin)


def orient_field(gx, gy, k=4, rep=2):
    """Поле ориентаций в удвоенном угле — устойчивая замена «плотности штриха».

    Плотность на горных листах насыщается: штрих сплошной, контраста нет, и
    корреляция цепляется за случайное. А **направление** штриха насыщения не
    знает — гравёр ведёт его по линии падения склона. Угол берём удвоенным,
    чтобы штрих «вверх» и «вниз» считались одним направлением, и нормируем на
    когерентность: там, где направления нет, вектор короткий и в корреляцию
    почти не входит.
    """
    a = blur(gx * gx - gy * gy, k=k, rep=rep)
    b = blur(2.0 * gx * gy, k=k, rep=rep)
    mag = np.hypot(a, b)
    scale = float(np.percentile(mag, 90)) + 1e-9
    unit = np.clip(mag / scale, 0, 1) / (mag + 1e-9)
    return a * unit, b * unit
