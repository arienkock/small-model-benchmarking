import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/average-speed":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return

        query = parse_qs(parsed.query)
        distance = query.get("distance", [None])[0]
        hours = query.get("hours", [None])[0]

        try:
            distance_val = float(distance) if distance is not None else 0.0
            hours_val = float(hours) if hours is not None else 0.0
        except (TypeError, ValueError):
            self.send_response(400)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "invalid number"}).encode())
            return

        if hours_val <= 0:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        avg = round(distance_val / hours_val, 2)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": avg}).encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
