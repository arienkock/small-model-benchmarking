#!/usr/bin/env python3
"""Simple static file server using only the Python standard library."""

import http.server
import socketserver
import os
from pathlib import Path

# Base directory for serving files
BASE_DIR = Path(__file__).parent / "public"

class StaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Set correct Content-Type based on file extension
        if self.path.endswith('.html'):
            self.send_header('Content-Type', 'text/html')
        elif self.path.endswith('.css'):
            self.send_header('Content-Type', 'text/css')
        elif self.path.endswith('.js'):
            self.send_header('Content-Type', 'application/javascript')
        elif self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/json')
        super().end_headers()

    def is_safe_path(self, path):
        """Reject paths containing '..' to prevent directory traversal."""
        # Normalize the path and check if it's within BASE_DIR
        try:
            resolved = (BASE_DIR / path).resolve()
            # Ensure the resolved path is still under BASE_DIR
            if resolved.is_relative_to(BASE_DIR):
                return True
            return False
        except (ValueError, RuntimeError):
            return False

    def do_GET(self):
        # Reject paths containing ".."
        if ".." in self.path:
            self.send_error(400, "Forbidden: path contains parent directory references")
            return

        # Get the file path
        file_path = self.path.lstrip('/').lstrip('\?')  # Remove leading slashes
        if not file_path:
            file_path = "index.html"

        # Check if file exists and is a file (not a directory)
        if not (BASE_DIR / file_path).exists():
            self.send_error(404, "Not Found")
            return

        if not (BASE_DIR / file_path).is_file():
            self.send_error(404, "Not Found")
            return

        # Serve the file
        super().do_GET()

    def log_message(self, format, *args):
        # Suppress default log messages
        pass

if __name__ == "__main__":
    # Change to the base directory to ensure correct relative paths
    os.chdir(BASE_DIR.parent)
    with socketserver.TCPServer(("0.0.0.0", 8080), StaticHandler) as httpd:
        print("Serving static files from ./public/ on port 8080")
        httpd.serve_forever()
