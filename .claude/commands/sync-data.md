---
description: Синхронизировать GPX-треки и фото из www/ в нативное iOS-приложение
---

Источник правды для маршрутов — папка `www/`. Синхронизируй данные в нативное
приложение, затем отчитайся, что изменилось.

Шаги:
0. Пересобери данные для сайта (после любых новых GPX/фото):
   - `node tools/build_route_index.js` → `www/routes_geom.json`
   - `bash tools/make_photo_variants.sh` → `www/photos_small`, `www/photos_med`
1. Скопируй треки и фото:
   - `www/*.gpx` → `hikingmap/hikingmap/GPX/`
   - `www/future_trips/*.gpx` → `hikingmap/hikingmap/GPX/future_trips/`
   - `www/photos/*` → `hikingmap/hikingmap/photos/` (рекурсивно)
   - `www/future_trips/photos/*` → `hikingmap/hikingmap/future_trips/photos/` (рекурсивно)
2. Покажи `git status` по `hikingmap/` — какие маршруты/фото добавились или изменились.
3. НЕ собирай и НЕ коммить без отдельной просьбы — только синхронизация и отчёт.

$ARGUMENTS
