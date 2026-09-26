#!/usr/bin/env python3
"""
Rate-limited API server.
- GET /api/time returns {"now": <unix timestamp>}
- Per-client rate limit: 5 requests per 60 seconds, keyed by client IP
- 6th+ requests within window return 429 with Retry-After header
"""

import http.server
import socketserver
import urllib.parse
import time
from datetime import datetime
import threading

# Rate limiting storage: ip -> list of timestamps (Unix seconds)
rate_limit = {}
rate_limit_lock = threading.Lock()

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/api/time':
            self.send_error(404)
            return
        
        client_ip = self.client_address[0]
        
        # Get current time for window calculation
        now = time.time()
        
        # Clean old timestamps (older than 60 seconds)
        with rate_limit_lock:
            timestamps = rate_limit.get(client_ip, [])
            # Remove timestamps older than 60 seconds
            timestamps[:] = [t for t in timestamps if now - t <= 60]
            rate_limit[client_ip] = timestamps
        
        # Count how many requests in the last 60 seconds
        count = len(timestamps)
        
        if count >= 5:
            # Rate limit exceeded: return 429 with Retry-After header
            retry_after = 60 - (now - timestamps[0]) if timestamps else 60
            # Ensure retry_after is at least 0 and not more than 60
            retry_after = max(1, min(60, retry_after))
            self.send_response(429)
            self.send_header('Retry-After', str(retry_after))
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Rate limit exceeded"}')
            return
        
        # Record this request
        timestamps.append(now)
        rate_limit[client_ip] = timestamps
        
        # Respond with JSON
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {"now": int(now)}
        self.wfile.write(response.encode())
    
    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(f"Error: {message}".encode())

class ThreadingTCPServer(socketserver.ThreadingTCPServer):
    def initialize(self, *args, **kwargs):
        self.allow_reuse_address = True
        super().initialize(*args, **kwargs)

def run_server(host='0.0.0.0', port=8080):
    with ThreadingTCPServer((host, port), RateLimitedHandler) as server:
        print(f"Server running on http://{host}:{port}")
        server.serve_forever()

if __name__ == '__main__':
    run_server()