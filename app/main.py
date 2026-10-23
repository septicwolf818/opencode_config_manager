#!/usr/bin/env python3
"""Serve the OpenCode Config Manager frontend using only the Python standard library."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8000"))
SCHEMA_URL = "https://opencode.ai/config.json"


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        endpoint = self.path.split("?", 1)[0]
        if endpoint in ("/schema.json", "/external-schema"):
            try:
                target = SCHEMA_URL
                if endpoint == "/external-schema":
                    requested = parse_qs(urlsplit(self.path).query).get("url", [""])[0]
                    parsed = urlsplit(requested)
                    allowed_reference = (
                        parsed.scheme == "https"
                        and parsed.netloc == "models.dev"
                        and parsed.path == "/model-schema.json"
                    )
                    if not allowed_reference:
                        self.send_error(400, "Unsupported external schema reference")
                        return
                    target = requested
                request = Request(target, headers={"User-Agent": "OpenCode-Config-Manager/1.0"})
                with urlopen(request, timeout=15) as response:
                    schema = response.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/schema+json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(schema)))
                self.end_headers()
                self.wfile.write(schema)
            except (URLError, TimeoutError) as error:
                message = f"Could not fetch the OpenCode schema: {error}".encode()
                self.send_error(502, message.decode())
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()


def main() -> None:
    handler = partial(AppHandler, directory=str(APP_DIR))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    print(f"OpenCode Config Manager: http://127.0.0.1:{PORT}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
