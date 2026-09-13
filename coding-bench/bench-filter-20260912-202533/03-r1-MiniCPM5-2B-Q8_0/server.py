import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == "/api/average-speed":
            parsed = urllib.parse.parse_qs(self.path)
            def num(key):
                val = parsed.get(key, [None])[0]
                return float(val) if val is not None else 0.0
            distance = num("distance")
            hours = num("hours")

            if hours <= 0:
                body = json.dumps({"error": "hours must be greater than 0"}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return

            avg = round(distance / hours, 2)
            body = json.dumps({"average_speed": avg}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "not found"}).encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("", 0), Handler).serve_forever()
