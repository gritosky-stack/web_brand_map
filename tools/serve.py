#!/usr/bin/env python3
"""Локальный сервер для www/ без кэширования.

⚠️ Обычный `python3 -m http.server` отдаёт файлы с Last-Modified, и браузер
по своей эвристике держит JS в кэше: после правки страница подтягивала
старый script.js, и исправленный баг «не исправлялся». Здесь каждый ответ
помечен no-store.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=ROOT)
print(f'http://localhost:{PORT}')
http.server.ThreadingHTTPServer(('', PORT), handler).serve_forever()
