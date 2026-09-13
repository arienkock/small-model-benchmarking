import http.server
import socketserver
import time
import threading
import json


class RateLimiter:
    """Tracks request timestamps per client IP."""

    def __init__(self, max_per_window: int, window_ms: int):
        self.max_per_window = max_per_window
        self.window_ms = window_ms
        self._timestamps: dict[str, list[float]] = {}

    def _window(self, ip: str) -> list[float]:
        now = time.time()
        cutoff = now - self.window_ms / 1000.0
        return [t for t in self._timestamps.get(ip, []) if t > cutoff]

    def record(self, ip: str):
        now = time.time()
        self._timestamps.setdefault(ip, []).append(now)

    def is_allowed(self, ip: str) -> bool:
        current = self._window(ip)
        if len(current) >= self.max_per_window:
            return False
        return True


class ThrottledRequestHandler(http.server.BaseHTTPRequestHandler):
    rate_limiter: RateLimiter | None = None

    def log_message(self, fmt: str, *args):
        pass  # suppress default logging

    def do_GET(self):
        if self.path == "/api/time":
            client_ip = self.client_address[0]
            print(f"DEBUG: client_ip={client_ip}, rate_limiter exists={self.rate_limiter is not None}", flush=True)
            if not self.rate_limiter:
                self.rate_limiter = RateLimiter(5, 60)
                print(f"DEBUG: created new rate limiter", flush=True)
            result = self.rate_limiter.is_allowed(client_ip)
            print(f"DEBUG: is_allowed={result}", flush=True)
            if not result:
                self.send_response(429)
                self.send_header("Retry-After", str(int(self.rate_limiter.window_ms / 1000.0)))
                self.end_headers()
                self.wfile.write(b"{\"error\": \"Too Many Requests\"}")
                return
            now = int(time.time())
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"now": now}).encode())
        else:
            self.send_response(404)
            self.end_headers()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True


def main():
    server = ThreadedHTTPServer(("0.0.0.0", 8080), ThrottledRequestHandler)
    server.rate_limiter = RateLimiter(5, 60)
    server.serve_forever()


if __name__ == "__main__":
    main()
