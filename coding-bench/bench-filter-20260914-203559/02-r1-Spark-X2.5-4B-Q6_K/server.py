"""Rate-limited API server using only the Python standard library.

- GET /api/time returns {"now": <unix timestamp>}.
- Per-client rate limit of 5 requests per 60 seconds, keyed by client IP.
- The 6th and later requests within the window return 429 with a
  Retry-After header.
"""

import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_REQUESTS = 5
WINDOW_SECONDS = 60


class RateLimiter:
    """Tracks request counts per client IP over a sliding time window."""

    def __init__(self):
        self._lock = threading.Lock()
        self._counts = {}  # ip -> list of monotonic timestamps (oldest first)

    def allow(self, ip):
        """Record a request for ip; return True if allowed, False if limited."""
        now = time.monotonic()
        with self._lock:
            timestamps = self._counts.setdefault(ip, [])
            # Prune timestamps outside the window (strictly older than window).
            while timestamps and now - timestamps[0] > WINDOW_SECONDS:
                timestamps.pop(0)
            if len(timestamps) >= MAX_REQUESTS:
                return False
            timestamps.append(now)
            return True

    def retry_after(self, ip):
        """Seconds until the current window ends for ip (0 if already expired)."""
        with self._lock:
            timestamps = self._counts.setdefault(ip, [])
            now = time.monotonic()
            while timestamps and now - timestamps[0] > WINDOW_SECONDS:
                timestamps.pop(0)
            if not timestamps:
                return 0
            elapsed = now - timestamps[0]
            remaining = WINDOW_SECONDS - elapsed
            if remaining <= 0:
                return 0
            return math.ceil(remaining)


class TimeHandler(BaseHTTPRequestHandler):
    """HTTP handler serving /api/time under the rate limit."""

    limiter = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.limiter = TimeHandler.limiter

    def do_GET(self):
        if self.path == "/api/time":
            self.handle_time()
        else:
            self.send_error(404, "Not Found")

    def handle_time(self):
        ip = self.client_address[0]

        if not self.limiter.allow(ip):
            retry_after = self.limiter.retry_after(ip)
            body = b'{"error": "rate limited"}'
            self.send_response(429)
            self.send_header("Retry-After", str(retry_after))
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return

        body = b'{"now": %d}' % int(time.time())
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # keep stderr clean
        pass


def main():
    TimeHandler.limiter = RateLimiter()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), TimeHandler)
    print("Rate-limited API server listening on port 8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
