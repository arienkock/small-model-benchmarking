"""HTTP server with rate limiting using only the Python standard library."""

import time
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

# Rate limit state: client_ip -> (count, window_start_time)
rate_limit_store = {}  # type: dict[str, tuple[int, float]]


def get_client_ip(cls: BaseHTTPRequestHandler) -> str:
    """Extract client IP from the request."""
    # Common proxy headers that might override the real IP
    for header in (
        "X-Forwarded-For",
        "CF-Connecting-IP",
    ):
        if header in cls.headers:
            return cls.headers[header].split(",")[0].strip()
    # Fallback to the real client IP
    return cls.client_address[0]


def is_rate_limited(client_ip: str, max_requests: int = 5, window_seconds: int = 60) -> bool:
    """Check if the client has exceeded the rate limit."""
    now = time.time()
    record = rate_limit_store.get(client_ip)
    if record is None:
        # First request from this client
        rate_limit_store[client_ip] = (1, now)
        return False
    count, window_start = record
    # If the window has passed, reset the counter
    if now - window_start >= window_seconds:
        rate_limit_store[client_ip] = (1, now)
        return False
    # Increment the count
    count += 1
    rate_limit_store[client_ip] = (count, window_start)
    return count >= max_requests


def send_retry_after(seconds: float) -> str:
    """Return a Retry-After header value."""
    return f"{seconds}s"


class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/time":
            # Check rate limit
            client_ip = get_client_ip(self)
            if is_rate_limited(client_ip):
                self.send_response(429)
                self.send_header("Retry-After", send_retry_after(60))
                self.end_headers()
                return
            # Return current time
            now = int(time.time())
            response = json.dumps({"now": now})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(response.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging to keep output clean
        pass


def run_server(port: int = 8000):
    server = HTTPServer(("0.0.0.0", port), APIHandler)
    print(f"Server running on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
