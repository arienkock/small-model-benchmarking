"""Rate-limited HTTP API using only the Python standard library.

GET /api/time returns {"now": <unix timestamp>}.
Per-client rate limit: 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a
Retry-After header.
"""

import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse


class RateLimiter:
    """Sliding-window rate limiter keyed by client IP."""

    def __init__(self, max_per_window, window_seconds):
        self.max_per_window = max_per_window
        self.window_seconds = window_seconds
        # client_ip -> (count, earliest_call_timestamp_monotonic)
        self._hits = {}

    def allow(self, client_ip):
        """Return True if a request is allowed, False if it is rate limited."""
        now = time.monotonic()
        cutoff = now - self.window_seconds

        entry = self._hits.get(client_ip)
        if entry is not None:
            count, earliest = entry
            if earliest < cutoff:
                # Window expired, reset the client's counter.
                del self._hits[client_ip]
                entry = None
            else:
                count += 1
                if count > self.max_per_window:
                    return False
                self._hits[client_ip] = (count, earliest)
                return True

        # New client or window just expired.
        self._hits[client_ip] = (1, now)
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "RateLimitAPI/1.0"

    # Shared rate limiter: 5 requests / 60 seconds.
    limiter = RateLimiter(max_per_window=5, window_seconds=60)

    def log_message(self, fmt, *args):
        # Keep the server output clean.
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/time":
            client_ip = self.client_address[0]

            if not self.limiter.allow(client_ip):
                # Rate limited: 429 with a Retry-After header.
                retry_after = max(
                    int(self.limiter._hits[client_ip][1]
                        + self.limiter.window_seconds
                        - time.monotonic()),
                    0,
                )
                self.send_response(429)
                self.send_header("Retry-After", str(retry_after))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "rate limited"}')
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"now": %d}' % int(time.time()))
        else:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "not found"}')


def main():
    server = HTTPServer(("0.0.0.0", 8000), Handler)
    print("Rate-limited API listening on port 8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
