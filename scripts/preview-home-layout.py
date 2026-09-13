"""Render synthetic Home cards with production CSS and report geometry regressions."""

import argparse
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
ALLOWED = set(json.loads((WEB / "asset-manifest.json").read_text())["home"])
STYLES = "\n".join(
    re.findall(r'<link rel="stylesheet"[^>]+>', (WEB / "index.html").read_text())
).replace('href="./', 'href="/')


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        asset = urlsplit(self.path).path.lstrip("/")
        if not asset:
            data = (
                (ROOT / "tests/browser/home-layout.html")
                .read_text()
                .replace("<!-- styles -->", STYLES)
                .encode()
            )
            mime = "text/html"
        elif asset in ALLOWED:
            data = (WEB / asset).read_bytes()
            mime = mimetypes.guess_type(asset)[0] or "application/octet-stream"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8794)
    args = parser.parse_args()
    print(f"Home layout fixtures: http://127.0.0.1:{args.port}/", flush=True)
    with HTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
