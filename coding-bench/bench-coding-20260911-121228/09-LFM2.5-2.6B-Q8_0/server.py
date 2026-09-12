#!/usr/bin/env python3
"""Static file server using only Python standard library."""

import http.server
import socketserver
import os
from pathlib import Path

# Ensure the public directory exists
PUBLIC_DIR = Path("public")
if not PUBLIC_DIR.exists():
    raise FileNotFoundError("public directory not found")

# Base URL for serving files
BASE_URL = "http://0.0.0.0:8080"

class StaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Set correct Content-Type for common file types
        if self.path.endswith(".html"):
            self.send_header("Content-Type", "text/html")
        elif self.path.endswith(".css"):
            self.send_header("Content-Type", "text/css")
        elif self.path.endswith(".js"):
            self.send_header("Content-Type", "application/javascript")
        elif self.path.endswith(".json"):
            self.send_header("Content-Type", "application/json")
        super().end_headers()

    def do_GET(self):
        # Reject paths containing ".." to prevent directory traversal
        if ".." in self.path:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Forbidden"}')
            return

        # Get the file path relative to public/
        try:
            file_path = (PUBLIC_DIR / self.path).resolve()
            # Ensure the resolved path is still within PUBLIC_DIR
            if not str(file_path).startswith(str(PUBLIC_DIR.resolve())):
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "Not found"}')
                return
        except (ValueError, RuntimeError):
            # Path resolution failed (e.g., not a valid path)
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Not found"}')
            return

        # If file exists and is a regular file, serve it
        if file_path.is_file():
            self.send_response(200)
            self.send_header("Content-Type", file_path.suffix or "application/octet-stream")
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
        else:
            # File not found
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Not found"}')

    def log_message(self, format, *args):
        # Suppress default log messages
        pass

if __name__ == "__main__":
    with socketserver.TCPServer(("", 8080), StaticHandler) as httpd:
        print(f"Serving static files from ./public/ at http://0.0.0.0:8080")
        httpd.serve_forever()
