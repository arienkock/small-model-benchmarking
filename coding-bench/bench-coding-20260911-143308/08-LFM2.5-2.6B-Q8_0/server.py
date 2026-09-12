#!/usr/bin/env python3
"""Guestbook web application server."""

import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# In-memory storage for entries
entries = []


def _is_valid_entry(name: str, message: str) -> tuple[bool, str]:
    """Validate entry name and message according to rules."""
    if not name or len(name) > 40:
        return False, "Name must be between 1 and 40 characters"
    if not message or len(message) > 200:
        return False, "Message must be between 1 and 200 characters"
    return True, None


class GuestbookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/entries":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            # Return entries newest first (most recent first)
            entries.sort(key=lambda e: e["timestamp"], reverse=True)
            data = {"entries": entries}
            self.wfile.write(json.dumps(data).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/entries":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                return

            name = data.get("name")
            message = data.get("message")

            ok, error = _is_valid_entry(name, message)
            if not ok:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": error}).encode())
                return

            timestamp = time.time()
            entry = {
                "name": name,
                "message": message,
                "timestamp": timestamp
            }
            entries.append(entry)
            # Keep entries sorted by timestamp (newest first)
            entries.sort(key=lambda e: e["timestamp"], reverse=True)
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"message": "Entry added successfully"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        # Catch any other POST requests
        parsed = urlparse(self.path)
        if parsed.path != "/api/entries":
            self.send_response(404)
            self.end_headers()
        else:
            self.send_response(405)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), GuestbookHandler)
    print("Guestbook server running on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
