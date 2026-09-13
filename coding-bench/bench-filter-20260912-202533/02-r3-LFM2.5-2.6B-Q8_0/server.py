"""HTTP server with per-client rate limiting and a /api/time endpoint."""

import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Per-client rate limiting: store timestamps of recent requests per IP
# Key: IP address, Value: list of request timestamps
_rate_limits = {}


def get_client_ip(client_address: str) -> str:
    """Extract client IP from the request (handles X-Forwarded-For if present)."""
    # If X-Forwarded-For is set, use the first IP (client)
    forwarded = client_address.split(",")[0]
    if forwarded == "-":
        return "unknown"
    return forwarded


class APIHandler(BaseHTTPRequestHandler):
    def handle_time(self):
        """Handle GET /api/time endpoint."""
        client_ip = get_client_ip(self.path)
        now = time.time()
        unix_timestamp = int(now)

        # Check rate limit for this client
        timestamps = _rate_limits.get(client_ip, [])
        # Remove timestamps older than 60 seconds
        cutoff = now - 60
        recent = [ts for ts in timestamps if ts > cutoff]
        _rate_limits[client_ip] = recent

        if len(recent) >= 5:
            # Rate limit exceeded — return 429
            response = {
                "error": "Rate limit exceeded",
                "retry_after": 60,
            }
            return f"HTTP/1.1 429 Too Many Requests\nContent-Type: application/json\nRetry-After: 60\n\n{response}"

        # Record this request
        _rate_limits[client_ip].append(now)
        return f'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{json.dumps({"now": unix_timestamp})}'

    def do_GET(self):
        if self.path == "/api/time":
            self.handle_time()
        else:
            self.send_error(404)

    def send_error(self, code):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": f"Not found: {self.path}"}).encode())


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8080), APIHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()
