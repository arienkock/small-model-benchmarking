#!/usr/bin/env python3
"""
Rate-limited API server.
- GET /api/time returns {"now": <unix timestamp>}
- Per-client rate limit: 5 requests per 60 seconds, keyed by client IP
- 6th+ request within window returns 429 with Retry-After header
"""

import http.server
import socketserver
import time
import json
from collections import defaultdict

# Rate limiting: store timestamps per client IP
rate_limits = defaultdict(list)

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Use self.path to get the request path
        path = self.path
        
        # Rate limit handling
        client_ip = self.client_address[0]
        now = time.time()
        
        # Remove timestamps outside the 60-second window
        rate_limits[client_ip] = [
            ts for ts in rate_limits[client_ip] 
            if ts >= now - 60
        ]
        
        # Count requests in the window
        requests_in_window = len(rate_limits[client_ip])
        
        if requests_in_window >= 5:
            # Rate limit exceeded
            retry_after = 60 - (now - rate_limits[client_ip][-1])
            # If no requests in window (shouldn't happen), use 60
            retry_after = max(60, retry_after)
            self.send_response(429)
            self.send_header('Retry-After', str(int(retry_after)))
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
            return
        
        # Add current request timestamp
        rate_limits[client_ip].append(now)
        
        if path == '/api/time':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"now": int(now)}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")

if __name__ == "__main__":
    PORT = 8000
    with socketserver.TCPServer(("", PORT), RateLimitedHandler) as httpd:
        print(f"Server running on http://localhost:{PORT}")
        httpd.serve_forever()
