import http.server
import socketserver
import time
import json
import urllib.parse
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # per-client rate limiting: IP -> list of request timestamps
    rate_limits = defaultdict(list)
    WINDOW_SECONDS = 60
    MAX_REQUESTS = 5

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Extract client IP
        client_ip = self.client_address[0]

        if path == '/api/time':
            # Check rate limit for this IP
            now = time.time()
            # Remove timestamps outside the window
            window_start = now - self.WINDOW_SECONDS
            rate_limits = self.rate_limits  # Use class variable via self
            rate_limits[client_ip] = [
                ts for ts in rate_limits[client_ip] if ts >= window_start
            ]
            # If we've made too many requests in this window, return 429
            if len(rate_limits[client_ip]) >= self.MAX_REQUESTS:
                # Calculate retry after (in seconds, round up)
                retry_after = int(self.WINDOW_SECONDS)  # 60 seconds
                self.send_response(429)
                self.send_header('Retry-After', str(retry_after))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                return

            # Record this request
            rate_limits[client_ip].append(now)

            # Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                "now": int(now)
            }
            self.wfile.write(json.dumps(response).encode())
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")


if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(( "", PORT ), RateLimitedHandler) as httpd:
        print(f"Server running on port {PORT}")
        httpd.serve_forever()
