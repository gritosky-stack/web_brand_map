#!/usr/bin/env python3
"""Заливка средних копий фотографий в R2.

В бандл приложения кладём только превью 400 px (~6 МБ на всё), а версии
1280 px живут здесь и подтягиваются при открытии фото на весь экран.
Ключи повторяют структуру папок, чтобы путь в приложении собирался
подстановкой: `photos/<маршрут>/IMG.JPG` → `photos_med/<маршрут>/IMG.JPG`.

    python upload_photos_r2.py ~/Desktop/map/www/photos_med photos_med
"""
import os
import sys
import mimetypes
from concurrent.futures import ThreadPoolExecutor

import boto3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upload_r2 import load_env


def main():
    src_root, prefix = sys.argv[1], sys.argv[2]
    env = load_env()

    session = boto3.session.Session()
    s3 = session.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    files = []
    for root, _dirs, names in os.walk(src_root):
        for n in names:
            if n.lower().endswith((".jpg", ".jpeg", ".png")):
                path = os.path.join(root, n)
                rel = os.path.relpath(path, src_root)
                files.append((path, f"{prefix}/{rel}"))

    total = sum(os.path.getsize(p) for p, _ in files)
    print(f"файлов: {len(files)}, объём: {total/1048576:.1f} МБ")

    done = [0]

    def put(item):
        path, key = item
        ctype = mimetypes.guess_type(path)[0] or "image/jpeg"
        s3.upload_file(path, env["R2_BUCKET"], key,
                       ExtraArgs={"ContentType": ctype,
                                  # Фото не меняются: пусть кэшируются надолго
                                  "CacheControl": "public, max-age=31536000, immutable"})
        done[0] += 1
        if done[0] % 25 == 0:
            print(f"  {done[0]}/{len(files)}", flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(put, files))

    print(f"готово: {done[0]} файлов в {env['R2_BUCKET']}/{prefix}/")


if __name__ == "__main__":
    main()
