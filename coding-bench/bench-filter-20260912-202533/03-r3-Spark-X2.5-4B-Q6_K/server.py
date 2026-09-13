import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/average-speed":
            self.send_error(404)
            return

        query = parse_qs(parsed.query)
        distance_raw = query.get("distance", [""])
        hours_raw = query.get("hours", [""])

        try:
            distance = float(distance_raw[0])
            hours = float(hours_raw[0])
        except (ValueError, TypeError):
            self._send_json(400, {"error": "distance and hours must be numbers"})
            return

        if hours <= 0:
            self._send_json(400, {"error": "hours must be greater than 0"})
            return

        average_speed = round(distance / hours, 2)
        self._send_json(200, {"average_speed": average_speed})

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Keep the console output clean
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    server.serve_forever()
