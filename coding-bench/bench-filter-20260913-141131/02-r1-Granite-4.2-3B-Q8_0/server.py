#!/usr/bin/env python3
"""
Rate-limited API server.
- GET /api/time returns {"now": <unix timestamp>}
- Per-client rate limit: 5 requests per 60 seconds, keyed by client IP
- 6th and further requests within the window return 429 with Retry-After header
"""

import http.server
import socketserver
import time
import json


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    RATE_LIMIT_REQUESTS = 5
    RATE_LIMIT_WINDOW = 60  # seconds

    # Map: client_ip -> list of timestamps of requests
    request_timestamps = {}

    def do_GET(self):
        if self.path == '/api/time':
            client_ip = self.client_address[0]
            now = time.time()

            # Get timestamps for this client IP, filter those within the window
            timestamps = self.request_timestamps.get(client_ip, [])
            recent_timestamps = [ts for ts in timestamps if ts >= now - self.RATE_LIMIT_WINDOW]
            count = len(recent_timestamps)

            if count < self.RATE_LIMIT_REQUESTS:
                # Process the request
                self.send_time_response(now)
                # Add current timestamp
                self.request_timestamps[client_ip] = timestamps + [now]
            else:
                # Rate limited - return 429
                self.send_rate_limit_response()
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())

    def send_time_response(self, now):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = json.dumps({"now": int(now)})
        self.wfile.write(response.encode())

    def send_rate_limit_response(self):
        self.send_response(429)
        self.send_header('Content-Type', 'application/json')
        # Retry-After header: wait for the window to expire
        # We'll use the full window size as a conservative estimate
        self.send_header('Retry-After', str(self.RATE_LIMIT_WINDOW))
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())


if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(("", PORT), RateLimitedHandler) as httpd:
        print(f"Server running on http://localhost:{PORT}")
        httpd.serve_forever()
