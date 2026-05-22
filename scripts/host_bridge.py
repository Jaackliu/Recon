#!/usr/bin/env python3
"""Tiny HTTP bridge: listens on localhost and opens folders in the OS file manager.

Docker containers reach this via host.docker.internal to open folders on the host.
macOS → Finder, Windows → Explorer, Linux → default file manager.

Run once on the host:

    python scripts/host_bridge.py &

The bridge only listens on 127.0.0.1 — it is never exposed to the network.
"""
from __future__ import annotations

import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 18923


def _open_folder(path: str):
    """Open a folder in the OS file manager (cross-platform)."""
    if sys.platform == "darwin":
        subprocess.run(["open", path], check=True)
    elif sys.platform == "win32":
        os.startfile(path)
    else:
        subprocess.run(["xdg-open", path], check=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        path = qs.get("path", [""])[0]
        if path:
            try:
                _open_folder(path)
                print(f"[bridge] Opened: {path}", flush=True)
            except Exception as exc:
                print(f"[bridge] Failed to open {path}: {exc}", flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass  # suppress default access logs


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[bridge] Listening on 127.0.0.1:{PORT} — Docker calls host.docker.internal:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[bridge] Stopped", flush=True)
        sys.exit(0)
