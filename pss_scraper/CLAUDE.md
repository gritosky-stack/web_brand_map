# pss_scraper — Python-скрапер маршрутов PSS

Собирает маршруты с planinarski-savez.rs (Planinarski savez Srbije),
обогащает геометрией/высотами и строит GeoJSON для карты.

## Окружение
Виртуальное окружение в `.venv/`. Запускать скрипты через него:
```
.venv/bin/python scraper.py
```
Зависимости — `requirements.txt` (requests, beautifulsoup4, lxml).

## Пайплайн (порядок имеет значение)
1. `scraper.py` — собирает список URL и сырые данные маршрутов.
2. `fix_parse.py` — чинит/нормализует распарсенные записи.
3. `enrich_geometry.py` — добавляет геометрию трека.
4. `backfill_elevation.py` — дотягивает профили высот.
5. `label_routes.py` + `merge_labels.py` — расставляет и сливает метки (сложность/регион).
6. `build_geojson.py` — финальный GeoJSON в `output/`.

## Правила
- Результаты пайплайна — в `output/`. Не коммить `.venv/` и `__pycache__/`.
- При скрапинге уважай источник: разумные паузы между запросами, не параллелить агрессивно.
- Итоговый GeoJSON потребляется веб-картой (`www/pss_routes_web.geojson`) и iOS (`PSSRoute`).
