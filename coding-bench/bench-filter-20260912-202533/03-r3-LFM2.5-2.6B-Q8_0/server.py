#!/usr/bin/env python3
"""HTTP server that computes average speed."""

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler


def handle_request() -> dict:
    """Handle GET /api/average-speed?distance=<num>&hours=<num>"""
    parsed = urllib.parse.urlparse(urllib.parse.urljoin('http://localhost', '/api/average-speed'))
    query = urllib.parse.parse_qs(parsed.query)

    distance_str = query.get('distance', [''])[0]
    hours_str = query.get('hours', [''])[0]

    try:
        distance = float(distance_str)
        hours = float(hours_str)
    except (ValueError, TypeError):
        return {'error': 'distance and hours must be valid numbers'}

    if hours <= 0:
        return {'error': 'hours must be greater than 0'}

    average = distance / hours
    return {'average_speed': round(average, 2)}


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        full_url = self.path
        print(f"Request path: {full_url}")
        if full_url == '/api/average-speed':
            result = handle_request()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            print(f"Request path does not match expected endpoint: {full_url}")
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

    def log_message(self, format, *args):
        pass  # Suppress log messages


def main():
    server = HTTPServer(('', 8000), AverageSpeedHandler)
    print("Server running on http://localhost:8000")
    server.serve_forever()


if __name__ == '__main__':
    main()
