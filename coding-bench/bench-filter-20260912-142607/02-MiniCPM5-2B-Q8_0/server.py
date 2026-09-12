import http.server
import socketserver
import time
import threading
from urllib.parse import urlparse


# Rate limit state: ip -> list of request timestamps
_rate_limits = {}
_lock = threading.Lock()

WINDOW_MS = 60
MAX_PER_WINDOW = 5


def _is_allowed(ip):
    """Return True if the IP has fewer than MAX_PER_WINDOW requests in the current window."""
    with _lock:
        now = time.time()
        window = [t for t in _rate_limits.get(ip, []) if now - t <= WINDOW_MS]
        return len(window) < MAX_PER_WINDOW


class TimeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/time":
            self.send_error(404, "Not Found")
            return

        ip = self.client_address[0]
        if not _is_allowed(ip):
            self.send_response(429)
            self.send_header("Retry-After", str(int(WINDOW_MS / 1000)))
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Too many requests"}')
            return

        now = int(time.time())
        body = b'{"now": ' + str(now).encode() + b'}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), TimeHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
