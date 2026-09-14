from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse

class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Check if path starts with /api/average-speed
        if not self.path.startswith('/api/average-speed'):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')
            return

        # Parse query parameters
        query_start = self.path.find('?')
        if query_start == -1:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing query parameters"}).encode())
            return

        query_string = self.path[query_start + 1:]
        parsed = urllib.parse.parse_qs(query_string)
        distance_str = parsed.get('distance', [''])[0]
        hours_str = parsed.get('hours', [''])[0]

        try:
            distance = float(distance_str)
            hours = float(hours_str)
        except ValueError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid parameter types"}).encode())
            return

        # Validate hours > 0
        if hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        # Compute average speed and round to 2 decimals
        speed = distance / hours
        speed_rounded = round(speed, 2)

        # Return JSON response
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {"average_speed": speed_rounded}
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        # Suppress default log output
        pass

def run_server(port=8000):
    server = HTTPServer(('localhost', port), AverageSpeedHandler)
    print(f'Server running on http://localhost:{port}')
    server.serve_forever()

if __name__ == '__main__':
    run_server()