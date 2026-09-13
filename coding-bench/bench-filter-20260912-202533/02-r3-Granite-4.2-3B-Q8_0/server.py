import http.server
import socketserver
import time
import json
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # Store rate limit state: ip -> list of timestamps
    rate_limit_states = defaultdict(list)
    RATE_LIMIT_REQUESTS = 5
    RATE_LIMIT_WINDOW = 60  # seconds

    def do_GET(self):
        if self.path == '/api/time':
            # Check rate limit for this client IP
            client_ip = self.client_address[0]
            now = time.time()

            # Clean old timestamps outside the window
            self.rate_limit_states[client_ip] = [
                ts for ts in self.rate_limit_states[client_ip]
                if now - ts < self.RATE_LIMIT_WINDOW
            ]

            # Count requests in the window
            request_count = len(self.rate_limit_states[client_ip])

            if request_count >= self.RATE_LIMIT_REQUESTS:
                # Rate limit exceeded
                retry_after = self.RATE_LIMIT_WINDOW - (now - self.rate_limit_states[client_ip][-1])
                retry_after = int(retry_after) + 1  # ceil to next second
                self.send_response(429)
                self.send_header('Retry-After', str(retry_after))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"now": int(now)}).encode())
                return

            # Add current request timestamp
            self.rate_limit_states[client_ip].append(now)

            # Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"now": int(now)}
            self.wfile.write(json.dumps(response).encode())
            return

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")

    def log_message(self, format, *args):
        # Suppress default log output
        pass


if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(("", PORT), RateLimitedHandler) as httpd:
        print(f"Serving on port {PORT}")
        httpd.serve_forever()
