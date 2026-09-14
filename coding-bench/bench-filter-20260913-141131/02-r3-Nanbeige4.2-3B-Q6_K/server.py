import http.server
import json
import time
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    MAX_REQUESTS = 5
    WINDOW_SECONDS = 60

    def _get_client_requests(self):
        return client_requests.get(self.client_address[0], [])

    def _add_request_and_check_limit(self):
        ip = self.client_address[0]
        now = time.time()
        window_start = now - self.WINDOW_SECONDS

        requests = client_requests.get(ip, [])

        # Remove timestamps older than the window
        requests = [ts for ts in requests if ts >= window_start]

        if len(requests) >= self.MAX_REQUESTS:
            return True  # rate limited — 6th+ request in window

        requests.append(now)
        client_requests[ip] = requests
        return False

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path == '/api/time':
            is_limited = self._add_request_and_check_limit()

            if is_limited:
                retry_after = self.WINDOW_SECONDS
                self.send_response(429)
                self.send_header('Retry-After', str(retry_after))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "rate limit exceeded"}).encode())
                return

            now = int(time.time())
            payload = json.dumps({"now": now}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_error(404, "Not found")

    def log_message(self, fmt, *args):
        super().log_message(fmt, *args)


client_requests = defaultdict(list)


def run(port=8080):
    server = http.server.HTTPServer(('0.0.0.0', port), RateLimitedHandler)
    print(f"Server running on port {port}")
    server.serve_forever()


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run(port)
