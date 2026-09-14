"""Rate-limited HTTP API using only the Python standard library."""

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

RATE_LIMIT = 5          # max requests per client per window
WINDOW_SECONDS = 60     # time window for the rate limit

# Per-client request timestamps (client IP -> list of monotonic times)
_requests: dict[str, list[float]] = {}


def _prune(timestamps: list[float]) -> list[float]:
    """Drop timestamps older than the current window."""
    cutoff = time.monotonic() - WINDOW_SECONDS
    return [t for t in timestamps if t >= cutoff]


def _allowed(client_ip: str) -> tuple[bool, int | None]:
    """Return (allowed, retry_after_seconds).

    Allows up to RATE_LIMIT requests; returns the seconds until the next
    request could go through when the limit is hit.
    """
    now = time.monotonic()
    timestamps = _requests.setdefault(client_ip, [])
    timestamps = _prune(timestamps)

    if len(timestamps) >= RATE_LIMIT:
        elapsed = now - timestamps[-1]
        retry_after = int(WINDOW_SECONDS - elapsed) + 1
        return False, retry_after

    timestamps.append(now)
    return True, None


def _send_json(status: int, body: dict, extra_headers: dict | None = None) -> None:
    data = json.dumps(body).encode()
    headers = extra_headers or {}
    headers["Content-Type"] = "application/json"
    headers["Content-Length"] = str(len(data))
    for key, value in headers.items():
        self._send_header(key, value)
    self._send_response(status)
    self._send_wfile(data)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/time":
            allowed, retry_after = _allowed(self.client_address[0])
            if not allowed:
                _send_json(429, {"error": "rate limit exceeded"})
                self_send_header("Retry-After", str(retry_after))
                self_send_response(429)
                return
            _send_json(200, {"now": int(time.time())})
            return
        _send_json(404, {"error": "not found"})

    def _send_header(self, name: str, value: str) -> None:
        self.send_header(name, value)

    def _send_response(self, status: int) -> None:
        self.send_response(status)

    def _send_wfile(self, data: bytes) -> None:
        self.wfile.write(data)

    def log_message(self, *args) -> None:
        # Keep the server output clean.
        pass


def main() -> None:
    server = HTTPServer(("0.0.0.0", 8000), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
