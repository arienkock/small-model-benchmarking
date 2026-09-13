#!/usr/bin/env python3
"""
Simple HTTP server that computes average speed.
Uses only Python standard library.
"""

import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query string
        parsed = urllib.parse.urlparse(self.path)
        query_params = urllib.parse.parse_qs(parsed.query)
        
        distance = query_params.get('distance')
        hours = query_params.get('hours')

        # Convert to numbers (parse_qs returns lists)
        try:
            distance_num = float(distance[0]) if distance else None
            hours_num = float(hours[0]) if hours else None
        except (ValueError, TypeError, IndexError):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"error": "Invalid distance or hours parameter"}
            self.wfile.write(json.dumps(response).encode())
            return

        # Validate hours > 0
        if hours_num is None or hours_num <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"error": "hours must be greater than 0"}
            self.wfile.write(json.dumps(response).encode())
            return

        # Compute average speed: distance / hours, rounded to 2 decimals
        speed = distance_num / hours_num
        speed_rounded = round(speed, 2)

        # Return JSON
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {"average_speed": speed_rounded}
        self.wfile.write(json.dumps(response).encode())


def run_server():
    PORT = 8080
    server = HTTPServer(("localhost", PORT), AverageSpeedHandler)
    print(f"Serving on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
