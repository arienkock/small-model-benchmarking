import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


def average_speed(distance: float, hours: float) -> float:
    """Return the average speed in km/h, rounded to 2 decimals."""
    return round(distance / hours, 2)


def send_json(handler, status: int, payload: dict) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.end_headers()
    handler.wfile.write(json.dumps(payload).encode("utf-8"))


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path != "/api/average-speed":
            send_json(self, 404, {"error": "Not found"})
            return

        query = parse_qs(parsed.query)
        distance_raw = query.get("distance", [""])[0]
        hours_raw = query.get("hours", [""])[0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (TypeError, ValueError):
            send_json(self, 400, {"error": "distance and hours must be numbers"})
            return

        if hours <= 0:
            send_json(self, 400, {"error": "hours must be greater than 0"})
            return

        try:
            speed = average_speed(distance, hours)
        except ZeroDivisionError:
            send_json(self, 400, {"error": "hours must be greater than 0"})
            return

        # Emit whole-number speeds as integers so JSON is {"average_speed": 48}
        if speed.is_integer():
            speed = int(speed)

        send_json(self, 200, {"average_speed": speed})

    def log_message(self, format, *args):
        # Keep the server log quiet
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8000), AverageSpeedHandler)
    print("Server running on http://127.0.0.1:8000")
    server.serve_forever()
