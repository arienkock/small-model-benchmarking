import http.server
import json
import urllib.parse


class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        distance_raw = query.get("distance")
        hours_raw = query.get("hours")

        distance = None
        hours = None

        if distance_raw:
            try:
                distance = float(distance_raw[0])
            except (TypeError, ValueError):
                pass

        if hours_raw:
            try:
                hours = float(hours_raw[0])
            except (TypeError, ValueError):
                pass

        if distance is None or hours is None or hours <= 0:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        average_speed = round(distance / hours, 2)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": average_speed}).encode())

    def log_message(self, fmt, *args):
        pass  # suppress default logging


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8080), AverageSpeedHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()
