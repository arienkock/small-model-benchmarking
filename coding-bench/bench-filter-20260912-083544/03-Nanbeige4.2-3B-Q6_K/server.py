from http.server import HTTPServer, BaseHTTPRequestHandler
import json


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query parameters
        query_string = self.path.split('?', 1)[1] if '?' in self.path else ''
        params = {}
        for pair in query_string.split('&'):
            key, val = pair.split('=')
            params[key] = val

        distance_str = params.get('distance', '')
        hours_str = params.get('hours', '')

        try:
            distance = float(distance_str)
        except (ValueError, TypeError):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance must be a number"}).encode())
            return

        try:
            hours = float(hours_str)
        except (ValueError, TypeError):
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
        print(fmt % args, flush=True)


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8080), AverageSpeedHandler)
    print('Server running on http://0.0.0.0:8080', flush=True)
    server.serve_forever()
