"""Rate-limited API server using only the Python standard library."""

import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse


# --- Rate limiting state ------------------------------------------------------

# client_ip -> deque of request timestamps (most recent first)
_rate_state = defaultdict(deque)

RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 60  # seconds


def _is_rate_limited(client_ip: str) -> tuple[bool, int]:
    """Return (limited, retry_after) for the given client IP.

    Returns (False, 0) when the request is allowed.
    Returns (True, retry_after) when the request is blocked.
    """
    now = time.time()
    q = _rate_state[client_ip]
    # Drop timestamps outside the window.
    q = deque(
        (ts for ts in q if now - ts <= RATE_LIMIT_WINDOW),
        maxlen=RATE_LIMIT_MAX,
    )
    if len(q) >= RATE_LIMIT_MAX:
        return True, RATE_LIMIT_WINDOW
    q.append(now)
    return False, 0


# --- HTTP handler -------------------------------------------------------------


class RateLimitedHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict, extra_headers: dict | None = None) -> None:
        data = json_dumps(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data.encode("utf-8"))

    def _client_ip(self) -> str:
        # Trust X-Forwarded-For only from trusted proxies; fall back to socket.
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            # Take the first entry (client-side proxy).
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/time":
            allowed, retry_after = _is_rate_limited(self._client_ip())
            if allowed:
                body = {"now": int(time.time())}
                self._send_json(200, body)
            else:
                self._send_json(
                    429,
                    {"error": "rate limited"},
                    {"Retry-After": str(retry_after)},
                )
            return

        # Unknown path: 404.
        self._send_json(404, {"error": "not found"})

    def log_message(self, fmt: str, *args) -> None:  # silence default logging
        return


def json_dumps(obj) -> str:
    import json

    return json.dumps(obj)


# --- Server setup -------------------------------------------------------------


def run(host: str = "0.0.0.0", port: int = 8000) -> None:
    server = HTTPServer((host, port), RateLimitedHandler)
    server.allow_reuse_address = True
    print(f"Rate-limited API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    run()
