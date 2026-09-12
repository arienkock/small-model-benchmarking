#!/usr/bin/env python3
"""HTTP server to compute average speed."""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query parameters
        query = urllib.parse.urlparse(self.path)
        path = query.path
        if path == "/api/average-speed":
            # Extract distance and hours from query string
            params = urllib.parse.parse_qs(query.get("query", ""))
            distance = params.get("distance", [None])[0]
            hours = params.get("hours", [None])[0]

            # Validate inputs
            if distance is None or hours is None:
                self.send_error(400, 'Missing parameters')
                return

            try:
                distance = float(distance)
                hours = float(hours)
            except (ValueError, TypeError):
                self.send_error(400, 'Invalid number format')
                return

            if hours <= 0:
                self.send_error(400, 'hours must be > 0')
                return

            # Compute average speed
            average_speed = distance / hours
            # Round to 2 decimal places
            average_speed = round(average_speed, 2)

            response = {
                "average_speed": average_speed
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404, "Not found")

    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if message:
            self.wfile.write(json.dumps({"error": message}).encode())
        else:
            self.wfile.write(b'{"error": "Not found"}')


def main():
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    print("Server running on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
