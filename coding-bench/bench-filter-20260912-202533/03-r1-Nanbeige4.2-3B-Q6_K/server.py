import http.server
import json
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path != "/api/average-speed":
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            return

        query = parse_qs(urlparse(self.path).query)
        distance = query.get("distance", [None])[0]
        hours = query.get("hours", [None])[0]

        # Validate distance and hours are numbers
        try:
            distance_val = float(distance)
        except (TypeError, ValueError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            return

        try:
            hours_val = float(hours)
        except (TypeError, ValueError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            return

        # Validate hours > 0
        if hours_val <= 0:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        average_speed = round(distance_val / hours_val, 2)
        response = {"average_speed": average_speed}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, fmt, *args):
        print(fmt % args)


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8080), AverageSpeedHandler)
    print("Server running on port 8080")
    server.serve_forever()
