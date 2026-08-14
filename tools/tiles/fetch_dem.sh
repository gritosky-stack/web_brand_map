#!/bin/bash
# Copernicus GLO-30 DEM, тайлы 1°×1° на Сербию с Косовом (открытая лицензия ESA)
base="https://copernicus-dem-30m.s3.amazonaws.com"
ok=0; miss=0
for lat in 41 42 43 44 45 46; do
  for lon in 18 19 20 21 22; do
    name="Copernicus_DSM_COG_10_N${lat}_00_E0${lon}_00_DEM"
    [ -f "$name.tif" ] && { ok=$((ok+1)); continue; }
    if curl -sSf --max-time 300 -o "$name.tif" "$base/$name/$name.tif"; then
      ok=$((ok+1))
    else
      rm -f "$name.tif"; miss=$((miss+1)); echo "нет тайла: N$lat E0$lon"
    fi
  done
done
echo "скачано: $ok, отсутствует: $miss"
du -sh .
