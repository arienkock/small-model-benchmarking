import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path != "/api/average-speed":
            self._send_json(404, {"error": "Not Found"})
            return

        query = parse_qs(parsed.query)
        distance_str = query.get("distance", [""])[0]
        hours_str = query.get("hours", [""])[0]

        try:
            distance = float(distance_str)
            hours = float(hours_str)
        except (ValueError, TypeError):
            self._send_json(400, {"error": "distance and hours must be numbers"})
            return

        if hours <= 0:
            self._send_json(400, {"error": "hours must be greater than 0"})
            return

        speed = distance / hours
        result = {"average_speed": round(speed, 2)}

        self._send_json(200, result)

    def log_message(self, format, *args):
        # Keep the console output clean during verification.
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
