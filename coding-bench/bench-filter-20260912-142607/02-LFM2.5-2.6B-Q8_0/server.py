#!/usr/bin/env python3
"""HTTP server with per-client rate limiting."""

import time
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Per-client rate limiting: dict mapping IP -> (count, window_start)
# Each client gets 5 requests per 60 seconds.
client_rates = {}
RATE_LIMIT = 5  # max requests per window
WINDOW_SECONDS = 60  # window size in seconds

def get_client_ip(client_address):
    """Extract client IP from the request address."""
    # For HTTP/1.1, the IP is in the X-Forwarded-For header if present,
    # otherwise in the connection address.
    # We'll use the first non-empty IP from X-Forwarded-For or the direct address.
    xff = client_address.split(";")[0].strip()
    if xff:
        return xff
    return client_address

class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/time":
            # Get client IP
            client_ip = get_client_ip(self.client_address)
            
            # Initialize rate limit for this client if needed
            if client_ip not in client_rates:
                client_rates[client_ip] = [0, time.time()]
            
            count, window_start = client_rates[client_ip]
            now = time.time()
            
            # Check if window has expired
            if now - window_start >= WINDOW_SECONDS:
                # Reset the window
                client_rates[client_ip] = [1, now]
            else:
                # Increment count
                client_rates[client_ip][0] += 1
                
                if client_rates[client_ip][0] >= RATE_LIMIT:
                    # Rate limit exceeded - return 429
                    self.send_response(429)
                    self.send_header("Retry-After", str(WINDOW_SECONDS))
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                    return
            
            # Success - return current unix timestamp
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {"now": int(now)}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass

def run_server(port=8080):
    server = HTTPServer(("0.0.0.0", port), APIHandler)
    print(f"Server running on http://0.0.0.0:{port}")
    server.serve_forever()

if __name__ == "__main__":
    run_server()
