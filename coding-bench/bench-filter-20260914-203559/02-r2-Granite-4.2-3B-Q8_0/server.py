import http.server
import socketserver
import time
import json
from collections import defaultdict


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # Store rate limit state: ip -> list of timestamps (in seconds)
    rate_limits = defaultdict(list)

    def do_GET(self):
        client_ip = self.client_address[0]
        now = time.time()
        
        # Get timestamps for this client, remove old ones (older than 60 seconds)
        timestamps = self.rate_limits[client_ip]
        timestamps = [ts for ts in timestamps if now - ts <= 60]
        timestamps.sort()
        
        # If we've already made 5 requests in the last 60 seconds,
        # this is the 6th request and should be rejected
        if len(timestamps) >= 5:
            self.send_response(429)
            self.send_header('Retry-After', '60')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
            return
        
        # Allow this request
        timestamps.append(now)
        self.rate_limits[client_ip] = timestamps
        
        response = {"now": int(now)}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        # Suppress default log output
        pass


class RateLimitTCPServer(socketserver.TCPServer):
    def serve_forever(self):
        socketserver.TCPServer.serve_forever(self)


if __name__ == "__main__":
    with RateLimitTCPServer(('', 8000), RateLimitedHandler) as server:
        print("Server running on http://localhost:8000")
        server.serve_forever()
