from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        
        distance_str = query.get('distance', [''])[0]
        hours_str = query.get('hours', [''])[0]
        
        try:
            distance = float(distance_str)
            hours = float(hours_str)
        except (ValueError, TypeError):
            self.send_error(400, 'Invalid number parameter')
            return
        
        if hours <= 0:
            self.send_error(400, 'hours must be > 0')
            return
        
        if distance < 0:
            self.send_error(400, 'distance cannot be negative')
            return
        
        average = round(distance / hours, 2)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {'average_speed': average}
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        pass  # Suppress logging


def run_server(port=8000):
    server = HTTPServer(('', port), AverageSpeedHandler)
    print(f'Server running on port {port}')
    server.serve_forever()

if __name__ == '__main__':
    run_server()
