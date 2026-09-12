from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse


class AverageSpeedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        
        distance = query.get('distance', [''])[0]
        hours = query.get('hours', [''])[0]
        
        try:
            distance = float(distance)
            hours = float(hours)
        except (ValueError, TypeError):
            self.send_error(400, 'Invalid number')
            return
        
        if hours <= 0:
            self.send_error(400, 'hours must be > 0')
            return
        
        average = distance / hours
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {'average_speed': round(average, 2)}
        self.wfile.write(json.dumps(response).encode())
    
    def do_POST(self):
        self.send_error(501, 'Not implemented')
    
    def log_message(self, format, *args):
        pass


def run_server(port=8000):
    server = HTTPServer(('', port), AverageSpeedHandler)
    print(f'Server running on port {port}')
    server.serve_forever()

if __name__ == '__main__':
    run_server()
