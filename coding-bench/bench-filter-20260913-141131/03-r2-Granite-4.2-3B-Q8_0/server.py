#!/usr/bin/env python3
"""
Simple HTTP server that computes average speed.
GET /api/average-speed?distance=240&hours=5 returns {"average_speed": 48}
hours must be > 0, otherwise return 400 with {"error": "..."}.
"""

import http.server
import json
import socketserver
import urllib.parse
import re
from typing import Dict, Any


class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        distance = query.get('distance')
        hours = query.get('hours')

        # Validate and parse distance and hours
        if not distance or not hours:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance and hours parameters are required"}).encode())
            return

        try:
            distance_val = float(distance[0])
            hours_val = float(hours[0])
        except ValueError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance and hours must be numbers"}).encode())
            return

        if hours_val <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        # Compute average speed
        avg_speed = round(distance_val / hours_val, 2)
        # Ensure integer output when whole number (e.g., 48 instead of 48.0)
        if avg_speed == int(avg_speed):
            avg_speed = int(avg_speed)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": avg_speed}).encode())

    def log_message(self, format, *args):
        # Suppress logging
        pass


if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(("", PORT), AverageSpeedHandler) as httpd:
        print(f"Server running on http://localhost:{PORT}")
        httpd.serve_forever()
