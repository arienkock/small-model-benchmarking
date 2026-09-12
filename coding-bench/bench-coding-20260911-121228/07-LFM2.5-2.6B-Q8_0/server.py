#!/usr/bin/env python3
"""HTTP server with rate limiting using only the Python standard library."""

import http.server
import socketserver
import time
import threading
from urllib.parse import urlparse

# Rate limiting state: client_ip -> (count, window_start_time)
# Using a simple dict with per-client tracking
client_counts = {}

# Lock for thread-safe access to client_counts
lock = threading.Lock()


def get_client_ip(client_ip: str) -> str:
    """Extract client IP from request (handles X-Forwarded-For if present)."""
    # If X-Forwarded-For is present, use the first IP
    forwarded = client_ip.split(";")[0].strip()
    if forwarded:
        return forwarded
    return client_ip


def is_rate_limited(client_ip: str, max_per_window: int = 5, window_seconds: int = 60) -> bool:
    """Check if the client has exceeded the rate limit."""
    with lock:
        now = time.time()
        if client_ip not in client_counts:
            client_counts[client_ip] = [0, now]
        count, window_start = client_counts[client_ip]
        # If window has expired, reset the counter
        if now - window_start >= window_seconds:
            client_counts[client_ip] = [1, now]
        else:
            client_counts[client_ip][0] += 1
        return count >= max_per_window


class RateLimitedHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse the request path
        parsed = urlparse(self.path)
        path = parsed.path

        # Handle /api/time endpoint
        if path == "/api/time":
            # Get client IP
            client_ip = get_client_ip(self.client_address[0])
            if is_rate_limited(client_ip, max_per_window=5, window_seconds=60):
                self.send_response(429)
                self.send_header("Retry-After", "60")
                self.end_headers()
                self.wfile.write(b"Too Many Requests")
                return

            # Return current time
            now = int(time.time())
            response = {"now": now}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
            return

        # For any other path, return 404
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

    def send_response(self, code: int, message: str = ""):
        """Override to add Retry-After header for 429 responses."""
        if code == 429:
            self.send_header("Retry-After", "60")
        super().send_response(code)
        if message:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(message.encode())

    def log_message(self, format, *args):
        # Suppress default log messages
        pass


def run_server(port: int = 8080):
    """Start the HTTP server."""
    with socketserver.TCPServer(("0.0.0.0", port), RateLimitedHTTPRequestHandler) as httpd:
        print(f"Server running on http://0.0.0.0:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    run_server()
