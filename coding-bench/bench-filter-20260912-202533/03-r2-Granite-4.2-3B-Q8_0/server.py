import http.server
import json
import urllib.parse

class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        distance = query.get('distance')
        hours = query.get('hours')
        if not distance or not hours:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "missing distance or hours"}).encode())
            return
        try:
            distance_val = float(distance[0])
            hours_val = float(hours[0])
        except ValueError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance and hours must be numbers"}).encode())
            return
        if hours_val <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return
        avg = distance_val / hours_val
        avg_rounded = round(avg, 2)
        # If the rounded value is an integer, return as integer; otherwise keep as float rounded to 2 decimals
        if avg_rounded == int(avg_rounded):
            avg_rounded = int(avg_rounded)
        response = {"average_speed": avg_rounded}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
    def log_message(self, format, *args):
        pass

def run():
    server = http.server.HTTPServer(('localhost', 8000), AverageSpeedHandler)
    print("Server running on http://localhost:8000")
    server.serve_forever()

if __name__ == '__main__':
    run()
