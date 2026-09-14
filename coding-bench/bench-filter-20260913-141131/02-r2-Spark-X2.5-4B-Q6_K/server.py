"""Rate-limited HTTP API using only the Python standard library."""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

RATE_LIMIT = 5          # max requests per window
WINDOW_SECONDS = 60     # window size in seconds

# client IP -> list of request timestamps (one per request)
_rate_limits: dict[str, list[float]] = {}


def _retry_after_seconds(now: float) -> int:
    """Seconds until the current 60s window resets."""
    window_start = now - (now % WINDOW_SECONDS)
    seconds_until_reset = window_start + WINDOW_SECONDS - now
    return max(1, int(seconds_until_reset))


def _allowed(client_ip: str, now: float) -> bool:
    """Return True if the client may make another request right now."""
    timestamps = _rate_limits.setdefault(client_ip, [])
    recent = [t for t in timestamps if now - t < WINDOW_SECONDS]
    return len(recent) < RATE_LIMIT


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/time":
            self.handle_time()
        else:
            self.send_error(404, "Not Found")

    def handle_time(self):
        client_ip = self.client_address[0]
        now = time.time()

        if not _allowed(client_ip, now):
            self.send_response(429)
            self.send_header("Retry-After", str(_retry_after_seconds(now)))
            self.end_headers()
            return

        # Record this request
        timestamps = _rate_limits.setdefault(client_ip, [])
        timestamps.append(now)
        _rate_limits[client_ip] = timestamps

        body = json.dumps({"now": int(now)}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # silence default logging
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    print("Rate-limited API running on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
