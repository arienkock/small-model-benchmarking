#!/usr/bin/env python3
"""Static file server using only the Python standard library."""

import http.server
import socketserver
import os
from pathlib import Path

# Base directory for serving files
PUBLIC_DIR = Path("public")

# Ensure the public directory exists
PUBLIC_DIR.mkdir(exist_ok=True)


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler that serves files from the public/ directory."""

    def __init__(self, *args, **kwargs):
        # Prevent path traversal by resolving the requested path
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        # Get the requested path (without the leading slash)
        parsed = self.path.split("?")
        path = parsed[0]

        # Reject paths containing ".." to prevent directory traversal
        if ".." in path:
            self.send_error(400, "Forbidden: path traversal not allowed")
            return

        # Resolve the absolute path within the public directory
        try:
            # Build the full path relative to public/
            full_path = (PUBLIC_DIR / path).resolve()
            # Ensure the resolved path is still within PUBLIC_DIR
            if not str(full_path).startswith(str(PUBLIC_DIR.resolve())):
                self.send_error(403, "Forbidden: path outside public directory")
                return
        except (ValueError, RuntimeError):
            self.send_error(400, "Bad request")
            return

        # Check if the file exists and is a file (not a directory)
        if not full_path.is_file():
            self.send_error(404, "Not found")
            return

        # Determine the correct Content-Type based on file extension
        ext = full_path.suffix.lower()
        content_types = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
        }

        content_type = content_types.get(ext, "application/octet-stream")

        # Send the response
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(full_path.read_bytes())))
        self.end_headers()
        self.wfile.write(full_path.read_bytes())

    def log_message(self, format, *args):
        # Suppress default log messages
        pass


def main():
    # Change to the workspace directory so relative paths work correctly
    os.chdir("/workspace")
    with socketserver.TCPServer(("0.0.0.0", 8080), StaticHandler) as httpd:
        print("Server running on http://0.0.0.0:8080")
        httpd.serve_forever()

if __name__ == "__main__":
    main()
