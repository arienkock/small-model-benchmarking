"""Rate-limited HTTP API server (Python standard library only).

Endpoints:
  GET /api/time -> {"now": <unix timestamp>}

Rate limiting:
  Per-client (client IP) limit of 5 requests per 60 seconds.
  The 6th and further requests within the window return 429 with a
  Retry-After header.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_REQUESTS = 5      # max requests allowed per window
WINDOW_SECONDS = 60   # rate-limit window length


class RateLimiter:
    """Sliding-window rate limiter keyed by client IP."""

    def __init__(self):
        self._requests: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, client_ip: str) -> bool:
        """Return True if the client is allowed to make a request now."""
        now = time.time()
        window_start = now - WINDOW_SECONDS

        with self._lock:
            requests = [t for t in self._requests.get(client_ip, []) if t > window_start]
            if len(requests) >= MAX_REQUESTS:
                return False
            requests.append(now)
            self._requests[client_ip] = requests
        return True


limiter = RateLimiter()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict | None = None, retry_after: int | None = None) -> None:
        payload = json.dumps(body or {"error": "rate limited"}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/api/time":
            if not limiter.allow(self.client_address[0]):
                self._send(429, retry_after=WINDOW_SECONDS)
                return
            self._send(200, {"now": int(time.time())})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args) -> None:  # silence default access logging
        return


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    print("Listening on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
