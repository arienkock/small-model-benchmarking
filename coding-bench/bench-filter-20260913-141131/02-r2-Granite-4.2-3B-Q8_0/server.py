import http.server
import socketserver
import time
import json
from urllib.parse import urlparse
from collections import defaultdict

# Rate limiting: per-client (IP) 5 requests per 60 seconds
# Store timestamps of when each client made requests
client_timestamps = defaultdict(list)

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/time':
            # Rate limiting
            client_ip = self.client_address[0]
            now = time.time()
            
            # Remove timestamps outside the 60-second window
            window_start = now - 60
            client_timestamps[client_ip] = [
                ts for ts in client_timestamps[client_ip] 
                if ts >= window_start
            ]
            
            if len(client_timestamps[client_ip]) >= 5:
                # Rate limit exceeded - 429 Too Many Requests
                self.send_response(429)
                self.send_header('Retry-After', '60')
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                return
            
            # Add current timestamp
            client_timestamps[client_ip].append(now)
            
            # Return time
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"now": int(now)}).encode())
            return
            
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'Not found')

if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(("", PORT), RateLimitedHandler) as httpd:
        print(f"Server running on http://localhost:{PORT}")
        httpd.serve_forever()
