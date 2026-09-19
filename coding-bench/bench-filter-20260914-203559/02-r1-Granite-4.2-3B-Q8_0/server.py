import http.server
import socketserver
import time
import json

class RateLimitedHandler(http.server.BaseHTTPRequestHandler):
    # rate_limit[ip] = list of timestamps (in seconds) for requests from that IP
    rate_limit = {}

    def do_GET(self):
        # Get client IP
        client_ip = self.client_address[0]
        now = time.time()

        # Check rate limit: 5 requests per 60 seconds
        if client_ip in self.rate_limit:
            timestamps = self.rate_limit[client_ip]
            # Keep only timestamps within the last 60 seconds
            recent = [t for t in timestamps if now - t <= 60]
            if len(recent) >= 5:
                # Rate limited: 6th and further requests
                self.send_response(429)
                self.send_header('Retry-After', '60')
                self.end_headers()
                return
            # Add current timestamp
            timestamps.append(now)
        else:
            timestamps = [now]

        self.rate_limit[client_ip] = timestamps

        # Handle /api/time
        if self.path == '/api/time':
            data = json.dumps({"now": int(now)})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(data.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    PORT = 8000
    with socketserver.TCPServer(( '', PORT ), RateLimitedHandler ) as httpd:
        print(f"Server running on port {PORT}")
        httpd.serve_forever()
