"""A rate-limited HTTP API using only the Python standard library.

- GET /api/time returns {"now": <unix timestamp>}.
- Per-client rate limit of 5 requests per 60 seconds, keyed by client IP.
- The 6th and further requests within the window return 429 with a
  Retry-After header.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

REQUESTS_PER_WINDOW = 5
WINDOW_SECONDS = 60

# Maps client IP -> deque of timestamps (sorted, oldest first) of requests.
_request_log = {}


def _rate_limited(ip, now):
    """Check if `ip` has exceeded the rate limit at time `now`.

    Returns (is_limited, retry_after_seconds). When not limited,
    the request timestamp is appended and (False, None) is returned.
    """
    entries = _request_log.get(ip)
    if entries is None:
        entries = []
        _request_log[ip] = entries

    # Sliding window: drop timestamps older than the current window.
    cutoff = now - WINDOW_SECONDS
    while entries and entries[0] < cutoff:
        entries.pop(0)

    if len(entries) >= REQUESTS_PER_WINDOW:
        # Time until the oldest entry in the window expires.
        retry_after = int(WINDOW_SECONDS - (now - entries[0]))
        if retry_after < 1:
            retry_after = 1
        return True, retry_after

    entries.append(now)
    return False, None


class TimeHandler(BaseHTTPRequestHandler):
    server_version = "RateLimitedAPI/1.0"

    def _send_json(self, status, payload, extra_headers=None):
        body = payload if isinstance(payload, bytes) else \
            json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/api/time":
            self._send_json(404, {"error": "not found"})
            return

        # Client IP is the peer address.
        try:
            client_ip = self.request.getpeername()[0]
        except (OSError, IndexError):
            client_ip = "unknown"

        now = int(time.time())
        limited, retry_after = _rate_limited(client_ip, now)

        if limited:
            self._send_json(
                429,
                {"error": "rate limit exceeded"},
                extra_headers={
                    "Retry-After": str(retry_after),
                },
            )
            return

        self._send_json(200, {"now": now})

    def log_message(self, fmt, *args):
        # Keep logs minimal; not required by the task.
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), TimeHandler)
    print("Rate-limited API listening on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
