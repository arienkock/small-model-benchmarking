#!/usr/bin/env python3
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/api/average-speed':
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not found"}')
            return

        query = urllib.parse.parse_qs(parsed.query)

        try:
            distance = float(query['distance'][0])
            hours = float(query['hours'][0])
        except (KeyError, ValueError):
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "Invalid input"}')
            return

        if hours <= 0:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "hours must be greater than 0"}')
            return

        result = {"average_speed": round(distance / hours, 2)}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    HTTPServer(('localhost', 8080), AverageSpeedHandler).serve_forever()
