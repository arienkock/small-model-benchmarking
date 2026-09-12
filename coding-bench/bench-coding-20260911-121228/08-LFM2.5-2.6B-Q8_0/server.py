#!/usr/bin/env python3
"""Guestbook web application server using only the Python standard library."""

import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# In-memory storage for entries
entries = []


def get_newest_entries() -> list:
    """Return entries sorted by timestamp, newest first."""
    return sorted(entries, key=lambda e: e['timestamp'], reverse=True)


class GuestbookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/entries':
            entries = get_newest_entries()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'entries': entries}).encode())
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Not found"}')

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/entries':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Empty body'}).encode())
                return

            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode())
                return

            name = data.get('name', '')
            message = data.get('message', '')

            # Validate name
            if not name or len(name) > 40:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Name must be 1-40 characters'}).encode())
                return

            # Validate message
            if not message or len(message) > 200:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Message must be 1-200 characters'}).encode())
                return

            # Create entry with timestamp
            timestamp = time.time()
            entry = {
                'name': name,
                'message': message,
                'timestamp': timestamp
            }
            entries.append(entry)
            # Keep list sorted by timestamp (newest first)
            entries.sort(key=lambda e: e['timestamp'], reverse=True)

            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'entry': entry}).encode())
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Not found"}')

    def do_POST(self):
        pass

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(('0.0.0.0', 8080), GuestbookHandler)
    print("Guestbook server starting on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == '__main__':
    main()
