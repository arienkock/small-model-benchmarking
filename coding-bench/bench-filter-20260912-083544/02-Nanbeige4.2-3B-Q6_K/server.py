"""Rate-limited HTTP API server using Python standard library only."""

import http.server
import json
import ipaddress
import time
from collections import defaultdict


# Per-client rate limit state: {client_ip: [timestamps of recent requests]}
client_requests = defaultdict(list)

MAX_PER_WINDOW = 5
WINDOW_SECONDS = 60


class TimeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path != '/api/time':
            self.send_response(404)
            self.end_headers()
            return

        # Rate limiting logic keyed by client IP
        client_ip = self.client_address[0]
        now = time.time()
        window_start = now - WINDOW_SECONDS

        # Clean up old timestamps outside the current window
        client_requests[client_ip] = [
            ts for ts in client_requests[client_ip]
            if ts > window_start
        ]

        if len(client_requests[client_ip]) >= MAX_PER_WINDOW:
            retry_after = int(WINDOW_SECONDS - (now - client_requests[client_ip][-1]))
            self.send_response(429)
            self.send_header('Retry-After', retry_after)
            self.end_headers()
            return

        # Record this request
        client_requests[client_ip].append(now)

        # Return the current Unix timestamp
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"now": int(now)}).encode())

    def log_message(self, format, *args):
        # Suppress default logging for cleaner output
        pass


if __name__ == '__main__':
    server = http.server.HTTPServer(
        ('0.0.0.0', 8000),
        TimeHandler
    )
    print("Server running on http://0.0.0.0:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server stopped.")
