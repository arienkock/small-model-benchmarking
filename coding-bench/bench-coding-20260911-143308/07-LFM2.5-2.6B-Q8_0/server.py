#!/usr/bin/env python3
"""HTTP server with per-client rate limiting using only the standard library."""

import time
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Per-client rate limiting: dict mapping IP -> (count, window_start)
# Each client gets 5 requests per 60 seconds.
rate_limits = {}


def get_client_ip(client_address: str) -> str:
    """Extract client IP from the request address."""
    # For HTTP, the IP is in the X-Forwarded-For header if behind a proxy,
    # otherwise it's in the connection info. We'll use the first non-IPv6
    # address from the client_address tuple.
    # client_address is (ip, port) or (None, None)
    if client_address and len(client_address) > 1:
        ip = client_address[0]
        # Simple check: IPv4 addresses start with 0-255, IPv6 are longer
        if ip and not ip.startswith('::') and not ip.startswith('['):
            return ip
    return 'unknown'


def is_rate_limited(ip: str) -> bool:
    """Check if the client has exceeded their rate limit."""
    now = time.time()
    if ip not in rate_limits:
        return False
    count, window_start = rate_limits[ip]
    # If the window has expired, reset the counter
    if now - window_start >= 60:
        rate_limits[ip] = (1, now)
        return False
    # Check if we've exceeded the limit
    if count >= 5:
        return True
    return False


def record_request(ip: str):
    """Record a successful request for the client."""
    now = time.time()
    if ip not in rate_limits:
        rate_limits[ip] = [1, now]
    else:
        count, window_start = rate_limits[ip]
        if now - window_start >= 60:
            rate_limits[ip] = [1, now]
        else:
            rate_limits[ip][0] += 1


def handle_request(request):
    """Handle an HTTP request."""
    parsed = urlparse(request.path)
    path = parsed.path
    query = parsed.query

    if path == '/api/time':
        # Return current Unix timestamp
        response = json.dumps({"now": int(time.time())})
        return response, 200

    # For any other path, return 404
    response = '{"error": "Not found"}'
    return response, 404


def send_retry_after(retry_after_seconds: float):
    """Send a 429 Too Many Requests response with Retry-After header."""
    response = (
        f'{"Content-Type": "application/json"}\n'
        f'{"Retry-After": {int(retry_after_seconds)}}\n'
        f'{"Body": "{"error": "Rate limit exceeded. Please try again later."}"}\n'
    )
    return response, 429


def send_200():
    """Send a 200 OK response."""
    response = '{"status": "ok"}'
    return response, 200


class RateLimitedHandler(BaseHTTPRequestHandler):
    """HTTP handler with per-client rate limiting."""

    def do_GET(self):
        # Get client IP
        client_ip = get_client_ip(self.client_address)

        # Check rate limit
        if is_rate_limited(client_ip):
            # Send 429 response
            retry_after = 60 - (time.time() - rate_limits[client_ip][1])
            if retry_after < 0:
                retry_after = 60
            self.send_response(429)
            self.send_header('Retry-After', str(int(retry_after)))
            self.end_headers()
            self.wfile.write(
                json.dumps({
                    "error": "Rate limit exceeded. Try again later."
                }).encode()
            )
            return

        # Process the request
        response, status = handle_request(self.requestline)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(response.encode())

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_server(port: int = 8080):
    """Start the HTTP server."""
    server = HTTPServer(('', port), RateLimitedHandler)
    print(f"Server starting on port {port}...")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
