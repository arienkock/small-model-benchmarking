#!/usr/bin/env python3
import http.server
import socketserver
import json
import time
from urllib.parse import urlparse


class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # Store rate limit state: ip -> list of timestamps
    rate_limit_store = {}
    
    def do_GET(self):
        parsed = urlparse(self.path)
        ip = self.client_address[0]
        path = parsed.path
        
        if path == '/api/time':
            # Check rate limit for this IP
            timestamps = self.rate_limit_store.get(ip, [])
            now = time.time()
            
            # Remove timestamps outside the 60-second window
            timestamps[:] = [ts for ts in timestamps if now - ts < 60]
            
            if len(timestamps) >= 5:
                # Rate limit exceeded
                retry_after = 60 - (now - timestamps[0])
                self.send_response(429)
                self.send_header('Retry-After', str(int(retry_after)))
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Rate limit exceeded"}).encode())
                return
            
            # Add current timestamp
            timestamps.append(now)
            self.rate_limit_store[ip] = timestamps
            
            # Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"now": int(now)}
            self.wfile.write(json.dumps(response).encode())
            return
        
        # For other paths, just serve normally
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b"Not found")


PORT = 8888
handler = RateLimitedHandler

# Use a socket option to allow reuse of the address
class MyTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with MyTCPServer(('', PORT), handler) as httpd:
    print(f"Server running on http://localhost:{PORT}")
    httpd.serve_forever()
