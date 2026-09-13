"""Rate-limited HTTP API built with the Python standard library only.

GET /api/time returns {"now": <unix timestamp>}.
A per-client rate limit of 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a
Retry-After header.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from math import ceil

REQUESTS_PER_WINDOW = 5
WINDOW_SECONDS = 60

# Per-client request timestamps, keyed by client IP.
_client_requests = {}
_lock = threading.Lock()


def _record(ip: str):
    """Record a request for the given client IP.

    Returns (allowed, retry_after_seconds):
      - allowed=True  -> the request was permitted.
      - allowed=False -> the request was rate limited; retry_after_seconds is
        how many seconds until the current window resets.
    """
    now = time.time()
    window_start = now - WINDOW_SECONDS

    timestamps = _client_requests.get(ip)
    if timestamps is None:
        timestamps = []
        _client_requests[ip] = timestamps

    # Keep only timestamps that fall inside the current 60s window.
    kept = [t for t in timestamps if t > window_start]

    with _lock:
        if len(kept) >= REQUESTS_PER_WINDOW:
            # Window is full: refuse and tell the client when it resets.
            if kept:
                retry_after = int(ceil(WINDOW_SECONDS - (now - kept[0])))
            else:
                retry_after = WINDOW_SECONDS
            return False, retry_after

        kept.append(now)
        _client_requests[ip] = kept
        # Keep memory bounded; only the most recent requests matter.
        if len(kept) > 100000:
            _client_requests[ip] = kept[-REQUESTS_PER_WINDOW:]

    return True, None


class RateLimitHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/time":
            ip = self.client_address[0]
            allowed, retry_after = _record(ip)

            if not allowed:
                payload = b'{"error": "rate limited"}'
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.send_header("Retry-After", str(retry_after))
                self.end_headers()
                self.wfile.write(payload)
                return

            body = json.dumps({"now": int(time.time())}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "not found"}')

    def log_message(self, fmt, *args):  # silence default request logging
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", 8000), RateLimitHandler)
    print("Server running on http://0.0.0.0:8000", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
