"""Rate-limited HTTP API server using Python standard library only."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timedelta
from threading import RLock
from collections import defaultdict
import socket
import json


# Per-client rate limit state: {client_ip: [(timestamp1, count), (timestamp2, count), ...]}
# We keep a sliding-window approach: store entries of (timestamp, count) for each client.
# On each request, we prune old entries (outside window) and track the count within window.

class RateLimitedHandler(BaseHTTPRequestHandler):
    MAX_PER_WINDOW = 5
    WINDOW_SECONDS = 60
    # Per-client rate limit state: ip -> list of (timestamp, count) for recent windows
    # We'll use a simpler approach: track timestamps of requests per client IP
    client_requests = defaultdict(list)
    lock = RLock()

    def do_GET(self):
        ip = self.client_address[0]
        now = datetime.now()

        with self.lock:
            # Prune entries older than WINDOW_SECONDS
            cutoff = now - timedelta(seconds=self.WINDOW_SECONDS)
            client_requests[ip] = [
                (ts, cnt) for ts, cnt in client_requests[ip]
                if ts >= cutoff
            ]

            # Count requests in current window
            recent_count = len(client_requests[ip])

            if recent_count >= self.MAX_PER_WINDOW:
                # Need to return 429
                retry_after = int((cutoff - now).total_seconds()) + 1
                self.send_response(429)
                self.send_header("Retry-After", retry_after)
                self.end_headers()
                return

            # Record this request
            client_requests[ip].append((now, recent_count + 1))

        # Return the time endpoint response
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"now": int(now.timestamp())}).encode())

    def log_message(self, format, *args):
        # Suppress default logging to keep output clean
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), RateLimitedHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
