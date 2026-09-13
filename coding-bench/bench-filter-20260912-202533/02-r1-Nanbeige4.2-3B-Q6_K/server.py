import http.server
import time
import json
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    MAX_REQUESTS = 5
    WINDOW_SECONDS = 60

    def _get_client_requests(self):
        ip = self.client_address[0]
        return ip_requests.get(ip, [])

    def _add_request(self, ip):
        ip_requests[ip].append(time.time())
        # Evict entries older than the window
        now = time.time()
        ip_requests[ip] = [t for t in ip_requests[ip] if now - t <= self.WINDOW_SECONDS]

    def _is_rate_limited(self, ip):
        now = time.time()
        window_start = now - self.WINDOW_SECONDS
        return len(ip_requests.get(ip, [])) > self.MAX_REQUESTS

    def _send_rate_limit_response(self, ip):
        now = time.time()
        window_start = now - self.WINDOW_SECONDS
        recent = [t for t in ip_requests.get(ip, []) if t >= window_start]
        next_window_reset = window_start
        retry_after = max(1, int(self.WINDOW_SECONDS - (now - next_window_reset)))
        self.send_response(429)
        self.send_header("Retry-After", str(retry_after))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error": "rate_limited"}')

    def do_GET(self):
        ip = self.client_address[0]
        if self._is_rate_limited(ip):
            self._send_rate_limit_response(ip)
            return

        now = int(time.time())
        payload = json.dumps({"now": now}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

        self._add_request(ip)

    def log_message(self, format, *args):
        pass  # silence default logging


# In-memory client request tracking: {ip: [timestamps]}
ip_requests = defaultdict(list)


def run(port=8000):
    server = http.server.HTTPServer(("0.0.0.0", port), RateLimitedHandler)
    print(f"Server running on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
