import http.server
import json
import urllib.parse
from typing import Optional

class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"Request path: {self.path}")
        parsed = urllib.parse.urlparse(self.path)
        print(f"Parsed query: {parsed.query}")
        query = urllib.parse.parse_qs(parsed.query)
        print(f"Parsed query dict: {query}")
        
        distance_str = query.get('distance')
        hours_str = query.get('hours')
        
        print(f"distance_str: {distance_str}")
        print(f"hours_str: {hours_str}")
        
        # Parse distance and hours
        try:
            distance = float(distance_str)
            hours = float(hours_str)
        except (ValueError, TypeError):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "distance and hours must be numbers"}).encode())
            return
        
        # Validate hours > 0
        if hours <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "hours must be greater than 0"}).encode())
            return
        
        # Calculate average speed
        average_speed = distance / hours
        # Round to 2 decimals
        average_speed = round(average_speed, 2)
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = json.dumps({"average_speed": average_speed})
        self.wfile.write(response.encode())
    
    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message or ""}).encode())

if __name__ == "__main__":
    server = http.server.HTTPServer(('localhost', 8000), AverageSpeedHandler)
    print("Server running on http://localhost:8000")
    server.serve_forever()
