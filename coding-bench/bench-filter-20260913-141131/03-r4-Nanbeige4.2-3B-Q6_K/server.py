import json
from http.server import HTTPServer, BaseHTTPRequestHandler


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query parameters
        query_string = self.path.split('?', 1)[1] if '?' in self.path else ''
        params = {}
        for pair in query_string.split('&'):
            key, val = pair.split('=')
            params[key] = val

        distance = params.get('distance')
        hours = params.get('hours')

        # Validate inputs
        if distance is None or hours is None:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing required parameters: distance and hours"}).encode())
            return

        try:
            distance_num = float(distance)
            hours_num = float(hours)
        except (ValueError, TypeError):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance and hours must be numbers"}).encode())
            return

        if hours_num <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return

        average_speed = round(distance_num / hours_num, 2)
        response = {"average_speed": average_speed}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8080), AverageSpeedHandler)
    print("Server running on port 8080", flush=True)
    server.serve_forever()
