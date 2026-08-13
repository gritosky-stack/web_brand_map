#!/bin/bash
# Готовит уменьшенные копии фотографий для сайта.
#
# Зачем: оригиналы с телефона весят в среднем 2.6 МБ (всего ~390 МБ), а сайт
# показывал их и в ленте превью 48×48, и в лайтбоксе. Теперь:
#   photos/<маршрут>/IMG.JPG        — оригинал (его же берёт iOS-приложение)
#   photos_small/<маршрут>/IMG.JPG  — 400 px: превьюшки, полоса в лайтбоксе, попап на карте
#   photos_med/<маршрут>/IMG.JPG    — 1280 px: большое фото в панели и в лайтбоксе
# Имена и структура папок совпадают с оригиналом — в script.js подмена сводится
# к замене `photos/` на `photos_small/` (см. _photoVariant).
#
# Скрипт инкрементальный: уже готовые и не устаревшие файлы пропускает,
# так что после добавления новых фото его можно просто запустить снова.
#
# Запуск:  bash tools/make_photo_variants.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

variants() {
    local src_root="$1" out_root="$2" max="$3" quality="$4"
    local made=0 skipped=0
    [ -d "$src_root" ] || return 0
    while IFS= read -r f; do
        rel="${f#"$src_root"/}"
        out="$out_root/$rel"
        if [ -f "$out" ] && [ "$out" -nt "$f" ]; then
            skipped=$((skipped + 1))
            continue
        fi
        mkdir -p "$(dirname "$out")"
        if sips -Z "$max" -s format jpeg -s formatOptions "$quality" "$f" --out "$out" >/dev/null 2>&1; then
            made=$((made + 1))
        else
            echo "  ⚠️  не смог обработать: $f"
        fi
    done < <(find "$src_root" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \))
    echo "  $out_root: создано $made, пропущено (уже готово) $skipped"
}

echo "Уменьшаю фотографии…"
variants "www/photos"               "www/photos_small"               400  60
variants "www/photos"               "www/photos_med"                1280  62
variants "www/future_trips/photos"  "www/future_trips/photos_small"  400  60
variants "www/future_trips/photos"  "www/future_trips/photos_med"   1280  62

echo
echo "Итого:"
du -sh www/photos www/photos_small www/photos_med 2>/dev/null
