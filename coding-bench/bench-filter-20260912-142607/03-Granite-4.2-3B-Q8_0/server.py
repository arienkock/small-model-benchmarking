#!/usr/bin/env python3
import http.server
import socketserver
import json
import re
from urllib.parse import urlparse, parse_qs


class AverageSpeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)

        distance = query_params.get('distance')
        hours = query_params.get('hours')

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
            self.wfile.write(json.dumps({"error": "hours must be positive"}).encode())
            return

        average_speed = round(distance_val / hours_val, 2)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"average_speed": average_speed}).encode())

    def log_message(self, format, *args):
        # Suppress default log output
        pass


if __name__ == '__main__':
    PORT = 5000
    with socketserver.TCPServer(('0.0.0.0', PORT), AverageSpeedHandler) as httpd:
        print(f'Server running on http://localhost:{PORT}/api/average-speed')
        httpd.serve_forever()
