"""HTTP server that computes the average speed of a trip.

Only the Python standard library is used.
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    """Handles GET requests for the /api/average-speed endpoint."""

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path != "/api/average-speed":
            self._send_error(404, "Not Found")
            return

        query = parse_qs(parsed.query)

        if "distance" not in query or "hours" not in query:
            self._send_error(
                400,
                "distance and hours are required",
            )
            return

        raw_distance = query["distance"][0]
        raw_hours = query["hours"][0]

        try:
            distance = float(raw_distance)
            hours = float(raw_hours)
        except (TypeError, ValueError):
            self._send_error(
                400,
                "distance and hours must be numbers",
            )
            return

        if hours <= 0:
            self._send_error(
                400,
                "hours must be greater than 0",
            )
            return

        average_speed = round(distance / hours, 2)
        if average_speed == int(average_speed):
            average_speed = int(average_speed)

        payload = {"average_speed": average_speed}
        body = json.dumps(payload).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Keep stdout/stderr clean during verification.
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    print("Average speed server listening on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
