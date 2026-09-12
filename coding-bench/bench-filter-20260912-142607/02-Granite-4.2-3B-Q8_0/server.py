import http.server
import json
import time
from urllib.parse import urlparse
import socket


class TimeHandler(http.server.BaseHTTPRequestHandler):
    # per-client IP cache: ip -> list of request timestamps
    client_cache = {}
    RATE_LIMIT_REQUESTS = 5
    RATE_LIMIT_WINDOW = 60  # seconds

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/time':
            client_ip = self.client_address[0]
            now = time.time()
            
            # Get or initialize list of timestamps for this client
            if client_ip not in self.client_cache:
                self.client_cache[client_ip] = []
            
            # Keep only timestamps within the window
            timestamps = self.client_cache[client_ip]
            timestamps[:] = [t for t in timestamps if now - t < self.RATE_LIMIT_WINDOW]
            
            # Check if we've hit the rate limit
            if len(timestamps) >= self.RATE_LIMIT_REQUESTS:
                # Rate limit exceeded - calculate when we can call again
                earliest_allowed = timestamps[0] + self.RATE_LIMIT_WINDOW
                retry_after = int(max(0, earliest_allowed - now))
                self.send_response(429)
                self.send_header('Retry-After', str(retry_after))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                return
            
            # Add current request timestamp
            timestamps.append(now)
            
            # Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"now": int(now)}
            self.wfile.write(json.dumps(response).encode())
            return
        
        # Default 404
        self.send_response(404)
        self.end_headers()


class Server(http.server.HTTPServer):
    def __init__(self, port):
        super().__init__((b'localhost', port), TimeHandler)


if __name__ == '__main__':
    # Bind to port 0 to get a random free port, then get the actual port
    server = Server(0)
    server_address = server.server_address
    port = server_address[1]
    server.serve_forever()

