from http.server import HTTPServer, BaseHTTPRequestHandler

import json
import urllib.parse
import math


def average_speed(distance: float, hours: float) -> float:
    """Compute average speed: distance / hours, rounded to 2 decimals."""
    return round(distance / hours, 2)


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/average-speed':
            # Parse query parameters
            query = urllib.parse.parse_qs(self.path)
            distance_str = query.get('distance', [''])[0]
            hours_str = query.get('hours', [''])[0]

            # Validate and convert
            try:
                distance = float(distance_str)
                hours = float(hours_str)
            except (ValueError, TypeError):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "distance and hours must be valid numbers"}).encode())

            if not distance_str or not hours_str:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "distance and hours cannot be empty"}).encode())
                return
                return

            if hours <= 0:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
                return

            result = average_speed(distance, hours)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"average_speed": result}).encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{\"error\": "Not found"}')

    def do_POST(self):
        self.send_response(405)
        self.end_headers()

    def log_message(self, format, *args):
        pass


def run_server(port=8000):
    server = HTTPServer(('', port), AverageSpeedHandler)
    print(f'Server running on http://localhost:{port}')
    server.serve_forever()


if __name__ == '__main__':
    run_server()
