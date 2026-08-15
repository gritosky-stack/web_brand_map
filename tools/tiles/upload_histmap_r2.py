#!/usr/bin/env python3
"""Публикация исторического слоя в R2: и файлом, и россыпью тайлов.

Слой должен работать в двух режимах, и им нужны разные формы одних и тех же
данных:

* **офлайн** — приложение качает один `.mbtiles` фоновой сессией и раскладывает
  на устройстве (этим занимается `upload_r2.py`, отдельный вызов);
* **онлайн** — карта просит тайлы по одному, поэтому дерево `{z}/{x}/{y}.jpg`
  должно лежать в бакете как отдельные объекты.

Этот скрипт делает второе: читает MBTiles и заливает тайлы под префикс
`histmap/<версия>/`. Ключи сразу в схеме XYZ — MBTiles хранит строки снизу
вверх (TMS), и переворот делаем здесь, чтобы приложение об этом не знало.

    python upload_histmap_r2.py serbia-histmap-v1.mbtiles v1

Заливка идёт пачками и переживает обрыв: с `--skip-existing` уже загруженные
ключи пропускаются, так что повторный запуск дешёвый.
"""
import argparse
import os
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upload_r2 import load_env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mbtiles")
    ap.add_argument("version", help="версия набора, она же префикс: v1")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--skip-existing", action="store_true",
                    help="не перезаливать уже лежащие тайлы — для докачки после обрыва")
    args = ap.parse_args()

    env = load_env()
    # Пул соединений под число потоков: иначе boto3 сериализует запросы
    # на дефолтных десяти и половина воркеров стоит в очереди
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
    prefix = f"histmap/{args.version}"

    existing = set()
    if args.skip_existing:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix + "/"):
            for obj in page.get("Contents", []):
                existing.add(obj["Key"])
        print(f"уже в бакете: {len(existing)} тайлов")

    db = sqlite3.connect(args.mbtiles)
    total = db.execute("select count(*) from tiles").fetchone()[0]
    print(f"тайлов к заливке: {total}")

    done = [0]
    failed = []

    def put(row):
        z, x, tms_y, data = row
        y = (1 << z) - 1 - tms_y                  # TMS → XYZ
        key = f"{prefix}/{z}/{x}/{y}.jpg"
        if key in existing:
            return
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=bytes(data),
                          ContentType="image/jpeg",
                          # Набор версионирован в пути, поэтому кэшировать можно навсегда
                          CacheControl="public, max-age=31536000, immutable")
        except ClientError as exc:
            failed.append((key, str(exc)))
            return
        done[0] += 1
        if done[0] % 2000 == 0:
            print(f"  {done[0]}/{total}", flush=True)

    # Читаем пачками: держать 30 тысяч блобов в памяти незачем
    cur = db.execute("select zoom_level, tile_column, tile_row, tile_data from tiles")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        while True:
            batch = cur.fetchmany(2000)
            if not batch:
                break
            list(pool.map(put, batch))

    print(f"готово: {done[0]} тайлов в {bucket}/{prefix}/")
    if failed:
        print(f"не залилось: {len(failed)}. Первые пять:")
        for key, err in failed[:5]:
            print(f"  {key}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
