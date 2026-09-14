import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


def send_json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def send_error_response(handler, status, message):
    send_json_response(
        handler,
        status,
        {"error": message},
    )


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/average-speed":
            send_error_response(self, 404, "Not Found")
            return

        query = parse_qs(parsed.query)
        if "distance" not in query or "hours" not in query:
            send_error_response(self, 400, "Missing required parameters: distance and hours")
            return

        distance_raw = query["distance"][0]
        hours_raw = query["hours"][0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (TypeError, ValueError):
            send_error_response(self, 400, "distance and hours must be numbers")
            return

        if hours <= 0:
            send_error_response(self, 400, "hours must be greater than 0")
            return

        speed = round(distance / hours, 2)
        if speed.is_integer():
            speed = int(speed)

        send_json_response(self, 200, {"average_speed": speed})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    server.serve_forever()
