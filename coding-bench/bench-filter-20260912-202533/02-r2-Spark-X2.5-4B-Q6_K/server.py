"""Rate-limited HTTP API built with only the Python standard library.

- GET /api/time returns {"now": <unix timestamp>}.
- Per-client rate limit: 5 requests per 60 seconds, keyed by client IP.
- The 6th and further requests within the window return 429 with a
  Retry-After header.
"""

import http.server
import json
import threading
import time
from collections import defaultdict, deque

HOST = "127.0.0.1"
PORT = 8000

MAX_PER_WINDOW = 5
WINDOW_MS = 60000

# Per-client deque of timestamps (seconds since process start) for each IP.
_rate_limits = defaultdict(deque)
_lock = threading.Lock()


def _check_rate_limit(ip):
    """Return (allowed, retry_after_seconds).

    Uses a sliding window: a request is allowed when fewer than
    MAX_PER_WINDOW requests have been made within the last WINDOW_MS.
    """
    now = time.monotonic()
    window_s = WINDOW_MS / 1000.0

    with _lock:
        timestamps = _rate_limits[ip]
        # Prune timestamps outside the current window.
        cutoff = now - window_s
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()

        if len(timestamps) >= MAX_PER_WINDOW:
            oldest = timestamps[0]
            # Time until the window slides past the oldest request.
            retry_after = oldest + window_s - now
            return False, retry_after

        # Request is allowed; record this one.
        timestamps.append(now)
        return True, 0.0


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/time":
            allowed, retry_after = _check_rate_limit(self.client_address[0])

            if not allowed:
                self.send_response(429)
                self.send_header("Retry-After", str(retry_after))
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                body = json.dumps({"error": "rate limited"}).encode("utf-8")
                self.wfile.write(body)
                return

            now = int(time.time())
            body = json.dumps({"now": now}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Keep logging quiet by default; not required by the task.
        pass


def main():
    server = http.server.HTTPServer((HOST, PORT), RateLimitedHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
