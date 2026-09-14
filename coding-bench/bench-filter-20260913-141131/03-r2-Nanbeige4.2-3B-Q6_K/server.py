import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

debug_file = '/workspace/debug_log.txt'


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def _debug(self, msg):
        with open(debug_file, 'a') as f:
            f.write(msg + '\n')
        print(msg, flush=True)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        self._debug(f'params={params}')

        distance_str = params.get('distance', [None])[0]
        hours_str = params.get('hours', [None])[0]
        self._debug(f'distance_str={distance_str!r} hours_str={hours_str!r}')

        # Parse distance and hours
        try:
            distance = float(distance_str)
        except (ValueError, TypeError) as e:
            self._debug(f'distance error: {e}')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance must be a number"}).encode())
            return

        try:
            hours = float(hours_str)
        except (ValueError, TypeError) as e:
            self._debug(f'hours error: {e}')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be a number"}).encode())
            return

        if hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        average_speed = round(distance / hours, 2)
        response = {"average_speed": average_speed}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8000), AverageSpeedHandler)
    print("Server running on http://0.0.0.0:8000", flush=True)
    server.serve_forever()
