#!/usr/bin/env python3
"""HTTP server with rate-limited /api/time endpoint."""

import http.server
import json
import time
import urllib.parse
from typing import Dict, List, Tuple

# Per-client rate limit tracking: client_ip -> [(timestamp, count), ...]
# We keep only entries within the sliding window to save memory.
rate_limit: Dict[str, List[Tuple[float, int]]] = {}


def get_client_ip(client_address: tuple) -> str:
    """Extract client IP from the Full-Header or X-Forwarded-For headers."""
    # self.client_address is a tuple (host, port)
    # Try X-Forwarded-For (first IP in the list)
    for forwarded in client_address[0].split(", "):
        ip = forwarded.strip()
        if ip:
            return ip
    # Fallback to the real IP (client_address[0] is the remote address)
    return client_address[0]


def is_rate_limited(client_ip: str, max_requests: int = 5, window_seconds: int = 60) -> bool:
    """Check if the client has exceeded the rate limit."""
    now = time.time()
    # Remove timestamps outside the window
    entries = rate_limit.get(client_ip, [])
    # Filter to only those within the window
    recent = [(ts, cnt) for ts, cnt in entries if now - ts < window_seconds]
    # If we already have max_requests in the window, it's rate limited
    if len(recent) >= max_requests:
        return True
    # Add current request
    rate_limit[client_ip].append((now, 1))
    return False


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        # Get client IP
        client_ip = get_client_ip(self.client_address)

        # Check rate limit
        if is_rate_limited(client_ip, max_requests=5, window_seconds=60):
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
            return

        # Serve /api/time
        if self.path == "/api/time":
            now = int(time.time())
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"now": now}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args) -> None:
        # Suppress default logging to keep output clean
        pass


if __name__ == "__main__":
    # Start server on port 8080
    server = http.server.HTTPServer(("0.0.0.0", 8080), RateLimitedHandler)
    print("Server running on http://0.0.0.0:8080")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
