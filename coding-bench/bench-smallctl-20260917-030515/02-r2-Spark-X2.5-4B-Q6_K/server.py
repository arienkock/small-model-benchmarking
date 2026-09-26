#!/usr/bin/env python3
"""A rate-limited HTTP API using only the Python standard library.

Endpoints:
  GET /api/time -> {"now": <unix timestamp>}

Rate limiting:
  Per-client (by client IP) limit of 5 requests per 60 seconds.
  The 6th and further requests within the window return 429
  with a Retry-After header set to the window duration.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse


# Rate limit configuration
MAX_REQUESTS = 5
WINDOW_SECONDS = 60

# In-memory sliding window per client IP.
# Maps an IP address -> list of request timestamps (seconds since epoch).
_REQUEST_LOG: dict[str, list[float]] = {}


def _client_ip(handler: BaseHTTPRequestHandler) -> str:
    """Return the client IP address from the request."""
    forwarded = handler.headers.get("X-Forwarded-For")
    if forwarded:
        # Take the first address in the chain (the original client).
        return forwarded.split(",")[0].strip()
    return handler.client_address[0]


def _is_rate_limited(ip: str) -> tuple[bool, int]:
    """Check whether the client is rate-limited for the current window.

    Returns (is_limited, retry_after_seconds).
    """
    now = time.time()
    timestamps = _REQUEST_LOG.get(ip, [])

    # Drop timestamps that are outside the current window.
    recent = [t for t in timestamps if now - t <= WINDOW_SECONDS]

    if len(recent) < MAX_REQUESTS:
        # Allow the request; record it.
        recent.append(now)
        # Keep only the most recent MAX_REQUESTS timestamps to bound memory.
        _REQUEST_LOG[ip] = recent[-MAX_REQUESTS:]
        return False, 0

    # Rate limited: tell the client how long to wait until the window resets.
    return True, WINDOW_SECONDS


class RateLimitedHandler(BaseHTTPRequestHandler):
    """HTTP request handler with per-client rate limiting."""

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (http.server convention)
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/time":
            is_limited, retry_after = _is_rate_limited(_client_ip(self))
            if is_limited:
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.send_header("Retry-After", str(retry_after))
                self.end_headers()
                self._send_json_body(429, {"error": "rate_limit_exceeded"})
                return

            now = time.time()
            self._send_json(200, {"now": int(now)})
            return

        # Unknown path -> 404.
        self._send_json(404, {"error": "not_found"})

    def _send_json_body(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        # Keep default logging but keep it quiet-friendly.
        super().log_message(fmt, *args)


def main() -> None:
    host = "127.0.0.1"
    port = 8000
    server = HTTPServer((host, port), RateLimitedHandler)
    server.allow_reuse_address = True
    print(f"Rate-limited API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
