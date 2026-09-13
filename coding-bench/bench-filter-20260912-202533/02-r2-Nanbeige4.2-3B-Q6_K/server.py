#!/usr/bin/env python3
"""Rate-limited HTTP API server using only the Python standard library."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
from collections import defaultdict
import time
import socket
import json


class RateLimitedHandler(BaseHTTPRequestHandler):
    # Rate limit: 5 requests per 60 seconds per client IP
    MAX_REQUESTS = 5
    WINDOW_SECONDS = 60

    def _get_client_requests(self):
        """Return a list of timestamps for requests from this client IP."""
        client_ip = self.client_address[0]
        return self.request_logs[client_ip]

    def _reset_client_log(self, client_ip):
        """Remove old timestamps older than the window from the client's log."""
        cutoff = time.time() - self.WINDOW_SECONDS
        self.request_logs[client_ip] = [
            ts for ts in self.request_logs[client_ip] if ts >= cutoff
        ]

    def _is_rate_limited(self, client_ip):
        """Check whether the client is exceeding the rate limit."""
        self._reset_client_log(client_ip)
        return len(self.request_logs[client_ip]) >= self.MAX_REQUESTS

    def _send_rate_limited(self, client_ip):
        """Send 429 response with Retry-After header."""
        retry_after = int(self.WINDOW_SECONDS)
        self.send_response(429)
        self.send_header("Retry-After", str(retry_after))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps({"error": "rate limit exceeded"}).encode()
        )

    def _send_time(self, client_ip):
        """Send the /api/time response."""
        now = int(time.time())
        body = json.dumps({"now": now}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        client_ip = self.client_address[0]
        path = self.path.split("?", 1)[0]

        if path == "/api/time":
            if self._is_rate_limited(client_ip):
                self._send_rate_limited(client_ip)
                return

            # Record this request and respond
            self.request_logs[client_ip].append(time.time())
            self._send_time(client_ip)
            return

        self.send_response(404)
        self.end_headers()

    # Suppress log spam for cleaner output
    def log_message(self, fmt, *args):
        pass


def main():
    port = 8000
    server = HTTPServer(("0.0.0.0", port), RateLimitedHandler)
    print(f"Server running on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server shutting down.")
    finally:
        server.server_close()


if __name__ == "__main__":
    import json  # Ensure json is available
    main()
