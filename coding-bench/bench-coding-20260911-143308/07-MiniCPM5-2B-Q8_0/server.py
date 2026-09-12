#!/usr/bin/env python3
"""Rate-limited HTTP server using only Python standard library.

GET /api/time returns {"now": <unix timestamp>}.

Per-client rate limit: 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a Retry-After header.
"""

import http.server
import socketserver
import time
import threading
from collections import defaultdict


# Per-IP rate limit storage: ip -> list of request timestamps
RATE_LIMIT_STORAGE = defaultdict(list)
_storage_lock = threading.Lock()


def _cleanup_window(timestamps, now):
    """Keep only timestamps within the last 60 seconds."""
    if now is None:
        return timestamps
    cutoff = now - 60
    return [t for t in timestamps if now - t < 60]


class RateLimitedRequestHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler with per-IP rate limiting."""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path != "/api/time":
            self.send_error(404, "Not Found")
            return

        client_ip = self.client_address[0]
        now = time.time()

        # Clean stale timestamps and acquire lock for thread-safe update
        with _storage_lock:
            timestamps = RATE_LIMIT_STORAGE[client_ip]
            timestamps = _cleanup_window(timestamps, now)

        # Rate limit: allow 5 requests, 6th+ returns 429
        if len(timestamps) >= 5:
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            self.wfile.write(b'{"error": "rate limit exceeded"}')
            return

        # Allow: record this request
        timestamps.append(now)
        RATE_LIMIT_STORAGE[client_ip] = timestamps

        # Respond
        body = '{"now": ' + str(int(now)) + '}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body.encode())


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", 8000), RateLimitedRequestHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
