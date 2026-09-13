"""Rate-limited API server using only the Python standard library.

GET /api/time returns {"now": <unix timestamp>}.
Per-client rate limit: 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a
Retry-After header.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Rate limit configuration
MAX_REQUESTS_PER_WINDOW = 5
WINDOW_SECONDS = 60


class RateLimiter:
    """Tracks per-client request counts within a sliding window."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # ip -> [count, window_end_monotonic]
        self._states: dict[str, list] = {}

    def allow(self, ip: str) -> tuple[bool, int]:
        """Check whether a request from `ip` is allowed.

        Returns (allowed, retry_after). retry_after is the number of seconds
        until the current window resets (0 when the request is allowed).
        """
        now = time.monotonic()
        state = self._states.get(ip)
        if state is None:
            self._states[ip] = [1, now + self.window_seconds]
            return True, 0

        count, window_end = state
        if now < window_end:
            count += 1
        else:
            # Window reset: start a fresh window.
            count = 1
            window_end = now + self.window_seconds

        if count > self.max_requests:
            return False, max(0, window_end - now)

        self._states[ip] = [count, window_end]
        return True, 0


class Handler(BaseHTTPRequestHandler):
    # Shared rate limiter for all requests.
    limiter = RateLimiter(MAX_REQUESTS_PER_WINDOW, WINDOW_SECONDS)

    def _send_json(
        self,
        status: int,
        payload: dict,
        extra_headers: dict | None = None,
    ) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/time":
            self.send_error(404)
            return

        ip = self.client_address[0]
        allowed, retry_after = self.limiter.allow(ip)

        if not allowed:
            self._send_json(
                429,
                {"error": "rate limited", "retry_after": retry_after},
                {"Retry-After": str(retry_after)},
            )
            return

        self._send_json(200, {"now": int(time.time())})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    print("Rate-limited API server listening on http://0.0.0.0:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
