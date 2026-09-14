import http.server
import socketserver
from urllib.parse import urlparse, parse_qs
import json

class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        distance = query.get('distance')
        hours = query.get('hours')
        if not distance or not hours:
            self.send_response(400)
            self.end_headers()
            self.writelines(json.dumps({"error": "missing distance or hours"}))
            return
        try:
            distance_val = float(distance[0])
            hours_val = float(hours[0])
        except ValueError:
            self.send_response(400)
            self.end_headers()
            self.writelines(json.dumps({"error": "distance and hours must be numbers"}))
            return
        if hours_val <= 0:
            self.send_response(400)
            self.end_headers()
            self.writelines(json.dumps({"error": "hours must be > 0"}))
            return
        avg = distance_val / hours_val
        avg = round(avg, 2)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.writelines(json.dumps({"average_speed": avg}))
    def log_message(self, format, *args):
        pass

with socketserver.TCPServer(( "", 8000 ), AverageSpeedHandler) as httpd:
    print("Serving on http://localhost:8000")
    httpd.serve_forever()