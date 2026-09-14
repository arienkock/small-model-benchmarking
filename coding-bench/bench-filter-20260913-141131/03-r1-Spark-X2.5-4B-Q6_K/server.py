import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/average-speed':
            self.send_error(404, 'Not Found')
            return

        query = parse_qs(parsed.query)
        distance_raw = query.get('distance', [''])[0]
        hours_raw = query.get('hours', [''])[0]

        try:
            distance = float(distance_raw)
            hours = float(hours_raw)
        except (TypeError, ValueError):
            self._send_json(400, {'error': 'distance and hours must be numbers'})
            return

        if hours <= 0:
            self._send_json(400, {'error': 'hours must be greater than 0'})
            return

        average_speed = round(distance / hours, 2)
        # Return as integer when the value is a whole number
        if average_speed == int(average_speed):
            average_speed = int(average_speed)
        self._send_json(200, {'average_speed': average_speed})

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(('127.0.0.1', 8000), AverageSpeedHandler)
    print('Server running on http://127.0.0.1:8000')
    server.serve_forever()


if __name__ == '__main__':
    main()
