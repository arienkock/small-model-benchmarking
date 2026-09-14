import http.server
import socketserver
import time
import json
from urllib.parse import urlparse
import sys


# Global dictionary to store timestamps per client IP
ip_timestamps = {}

class TimeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/time':
            client_ip = self.client_address[0]
            now = time.time()
            
            # Get recent timestamps for this IP (within last 60 seconds)
            timestamps = ip_timestamps.get(client_ip, [])
            recent = [t for t in timestamps if now - t < 60]
            
            # If already made 5 requests in the last 60 seconds
            if len(recent) >= 5:
                # Rate limit exceeded
                self.send_response(429)
                self.send_header('Retry-After', '60')
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                return
            
            # Add current timestamp
            timestamps.append(now)
            ip_timestamps[client_ip] = timestamps
            
            # Process the request
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"now": int(now)}).encode())
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())

def run_server():
    with socketserver.TCPServer(("", 8000), TimeHandler) as httpd:
        print("Server running on http://localhost:8000")
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()