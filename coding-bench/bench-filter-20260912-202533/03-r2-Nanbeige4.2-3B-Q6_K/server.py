import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        distance_raw = params.get("distance", [None])[0]
        hours_raw = params.get("hours", [None])[0]

        # Parse distance and hours
        try:
            distance = float(distance_raw)
        except (TypeError, ValueError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance must be a number"}).encode())
            return

        try:
            hours = float(hours_raw)
        except (TypeError, ValueError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be a number"}).encode())
            return

        if hours <= 0:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        average_speed = round(distance / hours, 2)
        response = {"average_speed": average_speed}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, fmt, *args):
        pass  # silence default logging


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    handler = server
    print("Server running on port 8000")
    server.serve_forever()
