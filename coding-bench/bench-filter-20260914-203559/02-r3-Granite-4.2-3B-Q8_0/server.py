import http.server
import socketserver
import time
import json
from collections import defaultdict

# Rate limiting: per-client IP, 5 requests per 60 seconds
rate_limit_window = 60  # seconds
max_requests = 5

# In-memory store for rate limits: ip -> list of timestamps
request_log = defaultdict(list)

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # self.path contains the path from the request line (e.g., "/api/time")
        path = self.path
        
        # Get client IP
        client_ip = self.client_address[0]
        
        # Check rate limit
        now = time.time()
        window_start = now - rate_limit_window
        # Keep only timestamps within the window
        request_log[client_ip] = [
            ts for ts in request_log[client_ip] if ts > window_start
        ]
        
        # Count requests in window
        request_count = len(request_log[client_ip])
        
        if request_count >= max_requests:
            # Rate limit exceeded - return 429
            retry_after = int(rate_limit_window - (now - request_log[client_ip][-1]))
            self.send_response(429)
            self.send_header('Retry-After', str(retry_after))
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
            return
        
        # Apply rate limit - record this request
        request_log[client_ip].append(now)
        
        if path == '/api/time':
            # Return current unix timestamp
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                "now": int(time.time())
            }
            self.wfile.write(json.dumps(response).encode())
            return
        
        # For other paths, return 404
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")
    
    def log_message(self, format, *args):
        # Suppress default log output
        pass

if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(( '', PORT ), RateLimitedHandler ) as httpd:
        print(f"Server running on http://localhost:{PORT}")
        httpd.serve_forever()
