#!/usr/bin/env python3
"""Static file server serving ./public/ using only the Python standard library."""

import json
import os
import urllib.parse
from http.server import SimpleHTTPRequestHandler, HTTPServer

PUBLIC_DIR = os.path.abspath("./public")

class PublicServeHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Reject paths containing ".."
        if ".." in self.path:
            self.send_error(404, "Invalid path")
            return

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Ensure the resolved path is within PUBLIC_DIR (prevent directory traversal)
        requested = os.path.normpath(path)
        abs_path = os.path.abspath(os.path.join(PUBLIC_DIR, requested))

        if not abs_path.startswith(os.path.abspath(PUBLIC_DIR) + os.sep):
            self.send_error(404, "File not found")
            return

        # Read file
        try:
            with open(abs_path, "rb") as f:
                content = f.read()
        except FileNotFoundError:
            body = json.dumps({"error": "Not found"}).encode()
            self.send_response(404)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return

        # Determine content type by extension
        ext = os.path.splitext(abs_path)[1].lower()
        if ext in (".html", ".css", ".js", ".json"):
            content_type = f"text/{ext[1:]}"
        else:
            content_type = "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-type", content_type)
        self.send_header("Content-disposition", f"attachment; filename={os.path.basename(abs_path)}")
        self.end_headers()
        self.wfile.write(content)

    def send_error(self, code, message=None):
        if message:
            self.send_response(code)
            self.send_header("Content-type", "application/json")
            body = json.dumps({"error": message}).encode()
            self.end_headers()
            self.wfile.write(body)
        super().send_error(code, message)


def main():
    server = HTTPServer(("0.0.0.0", 8000), PublicServeHandler)
    print(f"Serving files from {PUBLIC_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
