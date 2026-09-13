import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


def send_json_response(handler, status_code, data):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path != "/api/average-speed":
            send_json_response(self, 404, {"error": "Not Found"})
            return

        query = parse_qs(parsed.query)
        distance_raw = query.get("distance", [""])[0]
        hours_raw = query.get("hours", [""])[0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (TypeError, ValueError):
            send_json_response(self, 400, {"error": "distance and hours must be numbers"})
            return

        if hours <= 0:
            send_json_response(self, 400, {"error": "hours must be greater than 0"})
            return

        average_speed = round(distance / hours, 2)
        if average_speed == int(average_speed):
            average_speed = int(average_speed)
        send_json_response(self, 200, {"average_speed": average_speed})

    def log_message(self, format, *args):
        # Silence default request logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
