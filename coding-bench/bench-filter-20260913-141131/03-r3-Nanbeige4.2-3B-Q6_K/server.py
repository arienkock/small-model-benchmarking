import http.server
import json
import urllib.parse


class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        distance = params.get("distance", [None])[0]
        hours = params.get("hours", [None])[0]

        try:
            distance_val = float(distance)
            hours_val = float(hours)
        except (ValueError, TypeError):
            return self._send_json(400, {"error": "distance and hours must be numbers"})

        if hours_val <= 0:
            return self._send_json(400, {"error": "hours must be greater than 0"})

        avg_speed = round(distance_val / hours_val, 2)
        return self._send_json(200, {"average_speed": avg_speed})

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8000), AverageSpeedHandler)
    print("Server running on port 8000")
    server.serve_forever()
