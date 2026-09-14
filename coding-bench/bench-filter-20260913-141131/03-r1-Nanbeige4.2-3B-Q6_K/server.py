"""HTTP server using only Python standard library to compute average speed of a trip."""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query string
        query_params = urllib.parse.parse_qs(self.path.split('?', 1)[1])
        distance = float(query_params.get('distance', [None])[0])
        hours = float(query_params.get('hours', [None])[0])

        # Validate hours > 0
        if hours is None or hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode('utf-8'))
            return

        # Compute average speed, rounded to 2 decimals
        average_speed = round(distance / hours, 2)
        # Represent whole numbers without .0 in JSON
        if average_speed == int(average_speed):
            average_speed = int(average_speed)
        response = {"average_speed": average_speed}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode('utf-8'))

    def log_message(self, format, *args):
        # Suppress default logging noise for cleaner output
        pass


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8000), AverageSpeedHandler)
    print("Server running on port 8000")
    server.serve_forever()
