#!/usr/bin/env python3
"""Заливка тайлов в Cloudflare R2 по протоколу S3.

Ключи читаются из ~/.config/r2.env и в аргументы не попадают — иначе они
осели бы в истории команд.

    python upload_r2.py out/serbia-topo.mbtiles maps/serbia-topo.mbtiles
"""
import os
import sys
import threading

import boto3
from boto3.s3.transfer import TransferConfig


def load_env(path=os.path.expanduser("~/.config/r2.env")):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Progress:
    """Проценты в одну строку — заливка идёт долго, без них непонятно, живо ли."""

    def __init__(self, total):
        self.total = total
        self.done = 0
        self.lock = threading.Lock()
        self.last_shown = -1

    def __call__(self, chunk):
        with self.lock:
            self.done += chunk
            pct = int(self.done * 100 / self.total)
            if pct != self.last_shown and pct % 5 == 0:
                self.last_shown = pct
                print(f"  {pct}%  ({self.done/1048576:.0f} из {self.total/1048576:.0f} МБ)",
                      flush=True)


def main():
    src, key = sys.argv[1], sys.argv[2]
    env = load_env()

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    size = os.path.getsize(src)
    print(f"{src} → {env['R2_BUCKET']}/{key} ({size/1048576:.0f} МБ)")

    # Многочастная заливка: одним запросом такой объём не пройдёт
    config = TransferConfig(multipart_threshold=64 * 1024 * 1024,
                            multipart_chunksize=64 * 1024 * 1024,
                            max_concurrency=4)
    s3.upload_file(src, env["R2_BUCKET"], key,
                   Config=config, Callback=Progress(size),
                   ExtraArgs={"ContentType": "application/octet-stream"})

    head = s3.head_object(Bucket=env["R2_BUCKET"], Key=key)
    print(f"готово: {head['ContentLength']/1048576:.0f} МБ, ETag {head['ETag']}")


if __name__ == "__main__":
    main()
