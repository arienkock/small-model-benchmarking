#!/usr/bin/env python3
"""HTTP server for computing average trip speed."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    """Handle GET /api/average-speed?distance=...&hours=... requests."""

    def _send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/average-speed":
            self._send_json(404, {"error": "not found"})
            return

        params = parse_qs(parsed.query)
        distance = params.get("distance", [None])[0]
        hours = params.get("hours", [None])[0]

        try:
            distance_val = float(distance)
            hours_val = float(hours)
        except (TypeError, ValueError):
            self._send_json(400, {"error": "invalid input"})
            return

        if hours_val <= 0:
            self._send_json(400, {"error": "hours must be greater than 0"})
            return

        avg_speed = round(distance_val / hours_val, 2)
        self._send_json(200, {"average_speed": avg_speed})

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), AverageSpeedHandler)
    print("Serving on http://0.0.0.0:8080/api/average-speed")
    server.serve_forever()


if __name__ == "__main__":
    main()
