"""Rate-limited HTTP API using only the Python standard library.

GET /api/time returns {"now": <unix timestamp>}.

Per-client rate limit: at most 5 requests per 60 seconds, keyed by client IP.
The 6th and further requests within the window return 429 with a
Retry-After header.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

MAX_REQUESTS_PER_WINDOW = 5
WINDOW_SECONDS = 60
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000

# client_ip -> list of request timestamps (seconds since epoch)
_request_times = {}
_request_lock = threading.Lock()


class RateLimitedHandler(BaseHTTPRequestHandler):
    server_version = "RateLimitedAPI/1.0"

    def log_message(self, fmt, *args):
        # Keep the server log minimal.
        return

    # ------------------------------------------------------------------
    def _client_ip(self):
        return self.client_address[0]

    def _record_request(self, ip):
        """Record a request for the given client IP and return False if
        the request is allowed (False means "rejected / rate limited")."""
        now = time.time()
        with _request_lock:
            timestamps = _request_times.get(ip)
            if timestamps is None:
                timestamps = []
                _request_times[ip] = timestamps
            window = [t for t in timestamps if now - t <= WINDOW_SECONDS]
            if len(window) >= MAX_REQUESTS_PER_WINDOW:
                # 6th and further requests within the window -> 429.
                return True
            window.append(now)
            _request_times[ip] = window
        return False

    def _retry_after(self, ip):
        """Seconds until the oldest request in the current window expires."""
        with _request_lock:
            timestamps = _request_times.get(ip)
            if timestamps is None:
                return 0
            now = time.time()
            window = [t for t in timestamps if now - t <= WINDOW_SECONDS]
            if not window:
                return 0
            oldest = min(window)
            return int(max(0, WINDOW_SECONDS - (now - oldest)))

    # ------------------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/time":
            ip = self._client_ip()
            if self._record_request(ip):
                # Rate limited: 429 with Retry-After header.
                retry_after = self._retry_after(ip)
                self.send_response(429)
                self.send_header("Retry-After", str(retry_after))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                body = json.dumps({"error": "rate limited"}).encode("utf-8")
                self.wfile.write(body)
                return
            # Allowed: return current unix timestamp.
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            body = json.dumps({"now": int(time.time())}).encode("utf-8")
            self.wfile.write(body)
            return

        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "not found"}).encode("utf-8"))


def main():
    host = DEFAULT_HOST
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        host = sys.argv[1]
    if len(sys.argv) > 2:
        port = int(sys.argv[2])

    server = ThreadingHTTPServer((host, port), RateLimitedHandler)
    print(f"Rate-limited API server listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.shutdown()


if __name__ == "__main__":
    import sys

    main()
