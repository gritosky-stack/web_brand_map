#!/usr/bin/env python3
"""Тайлы крутизны склонов — в R2, для сайта.

Приложение держит их прямо в бандле (`hikingmap/hikingmap/Data/slope-tiles`,
см. `SlopeTiles` в `TopoTiles.swift`), а сайту брать их неоткуда: класть
22 МБ картинок в `www/` значит тащить их и в git, и в Capacitor-обёртку.
Поэтому они лежат в том же бакете, что и историческая карта:

    python upload_slope_r2.py            # → slope/v1/{z}/{x}/{y}.png

Ключи — из ~/.config/r2.env (см. upload_r2.py). Сайт берёт тайлы по
`SLOPE_TILES` в `www/extra_layers.js`; сменил данные — подними версию и там.
"""
import argparse
import os
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config

from upload_r2 import load_env

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "..", "hikingmap", "hikingmap", "Data", "slope-tiles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="v1")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    env = load_env()
    s3 = boto3.session.Session().client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(max_pool_connections=args.workers * 2,
                      retries={"max_attempts": 5, "mode": "standard"}),
    )
    bucket = env["R2_BUCKET"]

    files = []
    for dirpath, _, names in os.walk(ROOT):
        for name in names:
            if name.endswith(".png"):
                files.append(os.path.join(dirpath, name))
    print(f"тайлов к заливке: {len(files)}")

    def put(path):
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        with open(path, "rb") as f:
            s3.put_object(Bucket=bucket, Key=f"slope/{args.version}/{rel}", Body=f.read(),
                          ContentType="image/png",
                          # Версия в пути — кэшировать можно навсегда
                          CacheControl="public, max-age=31536000, immutable")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(put, files))
    print(f"готово: {len(files)} тайлов в {bucket}/slope/{args.version}/")


if __name__ == "__main__":
    main()
