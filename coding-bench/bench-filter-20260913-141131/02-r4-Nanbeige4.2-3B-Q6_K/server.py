"""Rate-limited HTTP API server using only the Python standard library."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
from collections import defaultdict
import json
import socket

# Rate limit config: 5 requests per 60 seconds per client IP
RATE_LIMIT = 5
WINDOW_SECONDS = 60

# Per-client rate-limit tracking: IP -> list of timestamps within the current window
client_requests = defaultdict(list)


class APIHandler(BaseHTTPRequestHandler):
    def _get_client_ip(self):
        """Extract client IP from the request."""
        # Try to get the real IP; otherwise fall back to remote addr
        xff = self.headers.get('X-Forwarded-For')
        if xff:
            # If X-Forwarded-For is present, use the first proxy-provided address
            return xff.split(',')[0].strip()
        return self.client_address[0]

    def _check_rate_limit(self):
        """Return True if request is allowed, False if 429 should be sent."""
        ip = self._get_client_ip()
        now = datetime.now(timezone.utc).timestamp()
        window_start = now - WINDOW_SECONDS

        # Remove timestamps older than the window
        client_requests[ip] = [ts for ts in client_requests[ip] if ts >= window_start]

        if len(client_requests[ip]) >= RATE_LIMIT:
            # Calculate Retry-After header: how many seconds until the window resets
            retry_after = max(1, int(window_start + 1))
            return False, retry_after

        client_requests[ip].append(now)
        return True, None

    def do_GET(self):
        if self.path == '/api/time':
            allowed, retry_after = self._check_rate_limit()
            if not allowed:
                self.send_response(429)
                self.send_header('Retry-After', retry_after)
                self.end_headers()
                return

            now = int(datetime.now(timezone.utc).timestamp())
            payload = json.dumps({"now": now}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        # Suppress default logging noise for cleaner output
        pass


def main():
    HOST = '0.0.0.0'
    PORT = 8000

    server = HTTPServer((HOST, PORT), APIHandler)
    print(f"Server running on http://{HOST}:{PORT}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == '__main__':
    main()
