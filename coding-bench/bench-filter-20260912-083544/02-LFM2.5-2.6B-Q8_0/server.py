import http.server
import socketserver
import json
from urllib.parse import urlparse


class RateLimitedHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse the URL to extract the path
        parsed = urlparse(self.path)
        # Handle the request
        response, status = handle_request(self, parsed.path)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(response.encode())

    def do_POST(self):
        parsed = urlparse(self.path)
        response, status = handle_request(self, parsed.path)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(response.encode())

    def log_message(self, format, *args):
        # Suppress default logging to keep output clean
        pass


def handle_request(handler, path):
    """Handle the request and return a response and status code."""
    if path == "/api/time":
        response = json.dumps({"time": "2026-04-10T00:00:00Z"})
        status = 200
    else:
        response = json.dumps({"error": "Not found"})
        status = 404
    return response, status


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8080), RateLimitedHTTPRequestHandler)
    print("Server running on http://0.0.0.0:8080")
