#!/usr/bin/env python3
"""HTTP server that computes average speed of a trip."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/average-speed":
            self.handle_query()
        else:
            self.send_error(404, "Not Found")

    def send_json(self, code, data):
        body = str(data).encode()
        self.send_response(code)
        self.send_header("Content-type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_query(self):
        qs = parse_qs(self.path.split("?")[1])
        try:
            distance = float(qs["distance"][0])
            hours = float(qs["hours"][0])
        except (KeyError, ValueError):
            self.send_json(400, {"error": "Invalid parameters"})
            return

        if hours <= 0:
            self.send_json(400, {"error": "hours must be greater than 0"})
            return

        avg = distance / hours
        self.send_json(200, {"average_speed": round(avg, 2)})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
