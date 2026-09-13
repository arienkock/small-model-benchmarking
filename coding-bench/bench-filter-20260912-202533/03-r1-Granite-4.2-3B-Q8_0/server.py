#!/usr/bin/env python3
"""
Simple HTTP server for average speed calculation.
GET /api/average-speed?distance=240&hours=5 returns JSON {"average_speed": 48}.
hours must be > 0, otherwise return 400 with {"error": "..."}
"""

import http.server
import json
import urllib.parse

class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        
        # distance and hours are lists of strings from parse_qs
        distance_str = params.get('distance', [''])[0]
        hours_str = params.get('hours', [''])[0]
        
        if not distance_str or not hours_str:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing distance or hours parameter"}).encode())
            return
        
        try:
            distance_val = float(distance_str)
            hours_val = float(hours_str)
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
        
        # Calculate average speed
        avg_speed = round(distance_val / hours_val, 2)
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": avg_speed}).encode())

def run_server(port=8000):
    server_address = ('', port)
    httpd = http.server.HTTPServer(server_address, AverageSpeedHandler)
    print(f"Server running on http://localhost:{port}")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
