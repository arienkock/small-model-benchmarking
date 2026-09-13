from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import urlparse, parse_qs


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/average-speed':
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')
            return

        params = parse_qs(parsed.query)
        distance_raw = params.get('distance', [None])[0]
        hours_raw = params.get('hours', [None])[0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (ValueError, TypeError):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid distance or hours"}).encode())
            return

        if hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be > 0"}).encode())
            return

        avg = round(distance / hours, 2)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": avg}).encode())

    def send_error(self, code, message):
        body = json.dumps(message).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8080), Handler)
    server.serve_forever()
