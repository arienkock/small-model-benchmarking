import http.server
import socketserver
import time
import json
import threading
import hashlib


# In-memory storage: ip -> list of timestamps of requests
_requests = {}


def get_now():
    return int(time.time())


class RateLimiter:
    """Simple per-client rate limiter."""

    def __init__(self):
        pass

    def check(self, ip: str, max_per_window: int, window_ms: int) -> bool:
        now = int(time.time())
        window_start = now - window_ms // 1000

        if ip not in _requests:
            _requests[ip] = []

        # Filter timestamps within the window
        filtered = [t for t in _requests[ip] if t >= window_start]
        if len(filtered) >= max_per_window:
            return False
        filtered.append(now)
        _requests[ip] = filtered
        return True


class TimeHandler(http.server.BaseHTTPRequestHandler):
    rate_limiter = RateLimiter()

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == '/api/time':
            ip = self.client_address[0]
            max_per_window = 5
            window_ms = 60_000
            if not self.rate_limiter.check(ip, max_per_window, window_ms):
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Retry-After', str(int(window_ms / 1000)))
                self.end_headers()
                self.wfile.write(b'{"error": "rate limit exceeded"}')
                return
            now = get_now()
            body = json.dumps({"now": now}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/time':
            ip = self.client_address[0]
            max_per_window = 5
            window_ms = 60_000
            if not self.rate_limiter.check(ip, max_per_window, window_ms):
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Retry-After', str(int(window_ms / 1000)))
                self.end_headers()
                self.wfile.write(b'{"error": "rate limit exceeded"}')
                return
            now = get_now()
            body = json.dumps({"now": now}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


def main():
    with socketserver.ThreadingTCPServer(('0.0.0.0', 8080), TimeHandler) as httpd:
        print('Serving on http://0.0.0.0:8080/api/time')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
