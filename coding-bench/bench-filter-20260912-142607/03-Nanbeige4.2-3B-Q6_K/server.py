from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        distance_raw = query.get("distance", [""])
        hours_raw = query.get("hours", [""])

        try:
            distance = float(distance_raw[0])
        except (TypeError, ValueError):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance must be a number"}).encode())
            return

        try:
            hours = float(hours_raw[0])
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
        # Convert whole-number floats to int for cleaner JSON output
        if average_speed == int(average_speed):
            average_speed = int(average_speed)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": average_speed}).encode())

    def log_message(self, fmt, *args):
        pass  # silence server logs


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8080), AverageSpeedHandler)
    print("Server running on port 8080")
    server.serve_forever()
