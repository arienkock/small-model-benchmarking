#!/usr/bin/env python3
"""
Rate-limited API server.
- GET /api/time returns {"now": <unix timestamp>}
- 5 requests per 60 seconds per client IP
- 6th+ request in window returns 429 with Retry-After header
"""

import http.server
import socketserver
import json
import time
from urllib.parse import urlparse
from datetime import datetime, timedelta
import threading
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # Track client IP -> list of request timestamps
    request_history = defaultdict(list)
    lock = threading.Lock()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/time':
            self.send_error(404, "Not Found")
            return

        client_ip = self.client_address[0]
        now = time.time()

        # Clean old timestamps (older than 60 seconds)
        with self.lock:
            # Remove timestamps outside the 60-second window
            self.request_history[client_ip] = [
                ts for ts in self.request_history[client_ip]
                if now - ts <= 60
            ]

        # Count requests in the current window
        request_count = len(self.request_history[client_ip])

        if request_count < 5:
            # Within limit - return time
            response = {"now": int(now)}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(json.dumps(response))))
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            # Rate limited - return 429
            retry_after = 60  # seconds
            self.send_response(429)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Retry-After', str(retry_after))
            self.send_header('Content-Length', '12')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())

        # Record this request
        with self.lock:
            self.request_history[client_ip].append(now)


PORT = 8000

with socketserver.TCPServer(("", PORT), RateLimitedHandler) as httpd:
    httpd.allow_reuse_address = True
    print(f"Serving on http://localhost:{PORT}")
    httpd.serve_forever()
