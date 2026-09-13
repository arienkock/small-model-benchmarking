#!/usr/bin/env python3
"""Rate-limited HTTP API server using only the Python standard library."""

import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict
import time


class RateLimitedHandler(BaseHTTPRequestHandler):
    """Per-client rate limiter: 5 requests per 60 seconds."""

    MAX_PER_WINDOW = 5
    WINDOW_SECONDS = 60

    # Per-client request timestamps: {client_ip: [timestamps]}
    _client_requests = defaultdict(list)

    def _get_client_ip(self):
        """Extract client IP from request."""
        return self.client_address[0]

    def _clean_old_requests(self, ip):
        """Remove timestamps older than the window."""
        cutoff = time.time() - self.WINDOW_SECONDS
        self._client_requests[ip] = [
            ts for ts in self._client_requests[ip] if ts >= cutoff
        ]

    def _check_rate_limit(self, ip):
        """Return (allowed, retry_after) for the given client IP."""
        now = time.time()
        self._clean_old_requests(ip)
        count = len(self._client_requests[ip])

        if count >= self.MAX_PER_WINDOW:
            oldest = self._client_requests[ip][0]
            retry_after = int(now - oldest)
            return False, retry_after

        return True, None

    def do_GET(self):
        ip = self._get_client_ip()
        allowed, retry_after = self._check_rate_limit(ip)

        if not allowed:
            self.send_response(429)
            self.send_header("Retry-After", retry_after)
            self.end_headers()
            return

        # Record this request
        self._client_requests[ip].append(time.time())

        # Return the current unix timestamp
        now_ts = int(time.time())
        body = json.dumps({"now": now_ts}).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def run_server(host="0.0.0.0", port=8000):
    server = HTTPServer((host, port), RateLimitedHandler)
    print(f"Server running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
