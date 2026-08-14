# Сборка собственных тайлов Сербии

Конвейер, которым собирается офлайн-карта: OpenStreetMap + Copernicus DEM +
публичные GPS-треки OSM → один `.mbtiles` → R2 → приложение.

Всё делается на своих данных с открытыми лицензиями. Тайлы Mapbox остались
только для рельефа (отмывка и 3D), своих высот у нас нет.

## Что нужно поставить

Homebrew на macOS Ventura собирает всё из исходников — это часы, поэтому в обход:

```
# JDK 21 для planetiler (готовая сборка, не через brew)
curl -sSL -o jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse"
tar xzf jdk.tar.gz

# planetiler
curl -sSL -O https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar

# tippecanoe из исходников — пара минут
git clone --depth 1 https://github.com/felt/tippecanoe.git && cd tippecanoe && make -j8

# питон: pyosmium для OSM, rasterio вместо системного GDAL (колесо тащит GDAL внутри)
python3.13 -m venv venv   && venv/bin/pip install osmium
python3.9  -m venv venv39 && venv39/bin/pip install rasterio contourpy boto3 mapbox-vector-tile
```

rasterio ставится только на Python 3.9: под 3.13+ готовых колёс нет, и pip
пытается собрать его от системного GDAL, которого нет.

## Порядок сборки

**1. Исходные данные**

```
curl -O https://download.geofabrik.de/europe/serbia-latest.osm.pbf
curl -O https://download.geofabrik.de/europe/kosovo-latest.osm.pbf
bash fetch_dem.sh          # Copernicus GLO-30, 29 тайлов по градусу, ~1.2 ГБ
```

**2. Векторная основа** (OpenMapTiles через planetiler, отдельно на каждый экстракт)

```
java -Xmx6g -jar planetiler.jar --osm-path=serbia.osm.pbf --output=serbia-osm.mbtiles \
  --download --force --minzoom=0 --maxzoom=14 --bounds=18.6,41.6,23.2,46.4
java -Xmx4g -jar planetiler.jar --osm-path=kosovo.osm.pbf --output=kosovo-osm.mbtiles \
  --force --minzoom=0 --maxzoom=14 --bounds=19.9,41.7,21.9,43.4
```

Слить экстракты в один файл нельзя: planetiler требует, чтобы узлы шли строго
по возрастанию id, а это два независимо отсортированных файла. `merge_pbf.py`
лежит здесь как памятник трём попыткам — проще собрать раздельно и склеить
тайлы через `tile-join`.

**3. Горизонтали** — шаг 20 м, из DEM

```
venv39/bin/python make_contours.py dem/ contours.geojsonl --interval 20
tippecanoe -o contours.mbtiles -l contour -Z9 -z14 --read-parallel \
  --simplification=4 --drop-densest-as-needed --force contours.geojsonl
```

**4. Железные дороги** — идут в бандл приложения, не в тайлы

```
venv/bin/python extract_railways.py railways.geojsonl serbia.osm.pbf kosovo.osm.pbf
```
Результат кладётся в `hikingmap/hikingmap/Data/railways.geojson` (1,6 МБ).
В тайлах они были бы доступны только на своей основе и только после скачивания,
а нужны везде, включая спутник.

**5. Хитмап** — публичные GPS-треки OSM

```
venv39/bin/python fetch_gps_traces.py traces --delay 1.2      # ~5 часов, 306 ячеек
venv39/bin/python split_traces.py traces/traces.geojsonl traces/clean.geojsonl --gap 250
tippecanoe -o heatmap.mbtiles -l heat -Z8 -z14 --read-parallel \
  --simplification=10 --drop-densest-as-needed --maximum-tile-bytes=180000 \
  --force traces/clean.geojsonl
```

Резать треки обязательно: у анонимных треков OSM не отдаёт время, и точки
приходят в порядке внутреннего индекса, а не прохождения. Соединять их подряд —
получить прямые через полстраны. До резки у каждой пятой линии было звено
длиннее 2 км.

`--maximum-tile-bytes` тоже обязателен. Без него в тайл z7 попадало сто тысяч
линий, после склейки с базой тайл вылезал за лимит 500 КБ, и `tile-join` молча
выбрасывал из него слои, а самый тяжёлый — целиком. На карте это выглядело как
белый прямоугольник в центре Сербии.

**6. Склейка и публикация**

```
tile-join -o serbia-topo-vN.mbtiles --force \
  -n "TOTSKII Wild — Srbija" -A "© OpenStreetMap contributors, Copernicus DEM" \
  serbia-osm.mbtiles kosovo-osm.mbtiles contours.mbtiles heatmap.mbtiles

venv39/bin/python upload_r2.py serbia-topo-vN.mbtiles maps/serbia-topo-vN.mbtiles
```

Версию поднимать в `TopoTilesDownloader.version`. Старые версии в R2 не удаляем:
место копеечное, зато откат — одна строка в коде.

`export_tiles.py` раскладывает `.mbtiles` в дерево `{z}/{x}/{y}.pbf` — то же
самое делает приложение на устройстве. Нужен для локальной проверки: дерево
можно скопировать прямо в контейнер симулятора.

## Фотографии

```
bash ../make_photo_variants.sh                                   # 400 px и 1280 px
venv39/bin/python upload_photos_r2.py ../../www/photos_med photos_med
```

В бандл идут только превью 400 px (7 МБ на все 168 снимков), версии 1280 px живут
в R2 и подтягиваются при открытии фото на весь экран. Так бандл держится
в районе 109 МБ вместо 500.

## Ключи

`upload_r2.py` и `upload_photos_r2.py` читают `~/.config/r2.env`:

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

В аргументы командной строки ключи не передаются намеренно — иначе осели бы
в истории шелла.
