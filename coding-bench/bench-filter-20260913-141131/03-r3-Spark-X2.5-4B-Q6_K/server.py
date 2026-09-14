import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/average-speed":
            self._send_error(404, {"error": "Not Found"})
            return

        query = parse_qs(parsed.query)
        distance_raw = query.get("distance", [""])[0]
        hours_raw = query.get("hours", [""])[0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (TypeError, ValueError):
            self._send_error(400, {"error": "distance and hours must be numbers"})
            return

        if hours <= 0:
            self._send_error(400, {"error": "hours must be greater than 0"})
            return

        average_speed = round(distance / hours, 2)
        if average_speed == int(average_speed):
            average_speed = int(average_speed)
        self._send_json(200, {"average_speed": average_speed})

    def _send_error(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    server.serve_forever()
