import http.server
import time
import json
from collections import defaultdict

RATE_LIMIT = 5       # requests per window
WINDOW_SECONDS = 60  # seconds

client_requests = defaultdict(list)

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def _get_recent_requests(self, client_ip, window):
        now = time.time()
        cutoff = now - window
        return [t for t in client_requests[client_ip] if t > cutoff]

    def _check_rate_limit(self, client_ip):
        recent = self._get_recent_requests(client_ip, WINDOCESTARS)
        if len(recent) >= RATE_LIMIT:
            retry_after = max(1, int(time.time() - recent[-1]))
            return True, retry_after
        return False, None

    def _add_request_timestamp(self, client_ip):
        client_requests[client_ip].append(time.time())

    def do_GET(self):
        path = self.path
        if path != '/api/time':
            self.send_response(404)
            self.end_headers()
            return

        client_ip = self.client_address[0]
        limit_hit, retry_after = self._check_rate_limit(client_ip)

        if limit_hit:
            self.send_response(429)
            self.send_header('Retry-After', retry_after)
            self.end_headers()
            return

        now = int(time.time())
        body = json.dumps({"now": now}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

        self._add_request_timestamp(client_ip)

    def log_message(self, *args):
        pass  # silence default logging

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 8000), RateLimitedHandler)
    print("Server running on http://0.0.0.0:8000")
    server.serve_forever()
