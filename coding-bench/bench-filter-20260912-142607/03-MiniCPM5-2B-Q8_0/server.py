#!/usr/bin/env python3
"""HTTP server that computes average speed from query parameters."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse
import json


def parse_params(path):
    """Parse URL query string into a dict of string values."""
    parsed = urllib.parse.urlparse(path)
    if not parsed.query:
        return {}
    return dict((k, v) for k, v in (pair.split('=', 1) for pair in parsed.query.split('&')))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            params = parse_params(self.path)
            distance = float(params.get('distance', 0) or 0)
            hours = float(params.get('hours', 0) or 0)
        except (ValueError, TypeError):
            self.send_error(400, "Invalid input")
            return

        if hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        avg_speed = distance / hours
        body = json.dumps({"average_speed": round(avg_speed, 2)}).encode()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
