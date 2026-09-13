import http.server
import socketserver
import time
import json
import threading
from collections import defaultdict

# Per-client rate limiting state: ip -> list of timestamps
_ratelimit = {}
_lock = threading.Lock()

def _get_client_ip(self):
    return self.client_address[0]

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logging

    def do_GET(self):
        if self.path == "/api/time":
            now = time.time()
            response = json.dumps({"now": int(now)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        else:
            self.send_response(404)
            self.end_headers()
            return

        # Rate limiting for /api/time
        with _lock:
            ip = _get_client_ip(self)
            if ip not in _ratelimit:
                _ratelimit[ip] = []
            timestamps = _ratelimit[ip]
            cutoff = time.time() - 60  # 60-second window

            # Remove timestamps outside the window
            timestamps[:] = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= 5:
                # 6th request and beyond -> 429
                self.send_response(429)
                self.send_header("Retry-After", "60")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "19")
                self.end_headers()
                self.wfile.write(b'{"error": "rate limit exceeded"}')
                return

            timestamps.append(time.time())

        # Allow the request through
        now = time.time()
        response = json.dumps({"now": int(now)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


class Handler(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True


def main():
    server = Handler(("", 8000), RateLimitedHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
