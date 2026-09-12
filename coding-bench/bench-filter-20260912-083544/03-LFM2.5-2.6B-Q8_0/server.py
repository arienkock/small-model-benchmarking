#!/usr/bin/env python3
"""HTTP server that computes average speed from distance and hours."""

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler


def handle_request(request):
    """Handle GET /api/average-speed?distance=<num>&hours=<num>"""
    try:
        # Parse query parameters
        params = urllib.parse.parse_qs(request.path)
        distance_str = params.get('distance', [''])[0]
        hours_str = params.get('hours', [''])[0]
    except Exception:
        return {"error": "Invalid query parameters"}

    # Validate distance
    try:
        distance = float(distance_str)
    except (ValueError, TypeError):
        return {"error": "distance must be a number"}

    # Validate hours > 0
    try:
        hours = float(hours_str)
    except (ValueError, TypeError):
        return {"error": "hours must be a number"}

    if hours <= 0:
        return {"error": "hours must be greater than 0"}

    # Compute average speed
    average_speed = distance / hours
    return {"average_speed": round(average_speed, 2)}


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/average-speed":
            result = handle_request(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    print("Server running on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
