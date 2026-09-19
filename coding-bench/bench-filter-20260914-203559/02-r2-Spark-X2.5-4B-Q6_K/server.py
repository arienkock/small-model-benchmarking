#!/usr/bin/env python3
"""A rate-limited HTTP API using only the Python standard library.

GET /api/time  ->  {"now": <unix timestamp>}

Per-client rate limit of 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a
Retry-After header.
"""

import math
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse


class RateLimiter:
    """Sliding-window rate limiter keyed by client IP.

    Allows at most ``max_per_window`` requests per ``window_seconds``.
    """

    def __init__(self, max_per_window, window_seconds):
        self.max_per_window = max_per_window
        self.window_seconds = window_seconds
        # ip -> deque of request timestamps (oldest first)
        self.hits = defaultdict(deque)

    def check(self, ip):
        """Return (status_code, retry_after) for a request from ``ip``."""
        now = time.time()
        dq = self.hits[ip]

        # Drop timestamps that have fallen out of the window.
        while dq and now - dq[0] >= self.window_seconds:
            dq.popleft()

        if len(dq) >= self.max_per_window:
            # Rate limited: tell the client when it may retry.
            oldest = dq[0]
            remaining = self.window_seconds - (now - oldest)
            retry_after = max(1, math.ceil(remaining))
            return 429, retry_after

        dq.append(now)
        return 200, None


class TimeHandler(BaseHTTPRequestHandler):
    # Shared limiter state across all handler instances.
    limiter = RateLimiter(max_per_window=5, window_seconds=60)

    def log_message(self, fmt, *args):
        # Keep console output clean.
        pass

    def _send_json(self, status, payload):
        body = payload if isinstance(payload, bytes) else \
            str(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/time":
            status, retry_after = self.limiter.check(self.client_address[0])
            if status == 429:
                self._send_json(
                    429,
                    {"error": "rate limited",
                     "retry_after": retry_after},
                )
            else:
                self._send_json(200, {"now": time.time()})
        else:
            self._send_json(404, {"error": "not found"})


def main():
    server = HTTPServer(("0.0.0.0", 8000), TimeHandler)
    print("Rate-limited API running on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
