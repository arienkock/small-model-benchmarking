#!/usr/bin/env python3
"""
Simple HTTP server for average speed calculation.
GET /api/average-speed?distance=240&hours=5 returns {"average_speed": 48}
hours must be > 0, otherwise return 400 with error.
"""

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/api/average-speed':
            self.send_json_error(404, 'Not found')
            return

        # Parse query parameters
        parsed = urllib.parse.parse_qs(self.path)  # Actually parse_qs works on query part; but self.path includes no query; we need urllib.parse.urlparse
        # Use urlparse to separate path and query.
        from urllib.parse import urlparse, parse_qs
        url_parts = urlparse(self.path)
        query = parse_qs(url_parts.query)
        distance_str = query.get('distance')
        hours_str = query.get('hours')

        if not distance_str or not hours_str:
            self.send_json_error(400, 'Missing distance or hours')
            return

        try:
            distance = float(distance_str)
            hours = float(hours_str)
        except ValueError:
            self.send_json_error(400, 'distance and hours must be numbers')
            return

        if hours <= 0:
            self.send_json_error(400, 'hours must be greater than 0')
            return

        speed = distance / hours
        speed_rounded = round(speed, 2)

        self.send_json_success(speed_rounded)

    def send_json_error(self, status_code, error_message):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'error': error_message}).encode())

    def send_json_success(self, value):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'average_speed': value}).encode())

    def do_OTHER(self):
        self.send_response(405)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'Method not allowed'}).encode())

def run(server_address='localhost:8000'):
    with HTTPServer(server_address, AverageSpeedHandler) as server:
        print(f'Server running on {server_address}:8000')
        server.serve_forever()

if __name__ == '__main__':
    run()