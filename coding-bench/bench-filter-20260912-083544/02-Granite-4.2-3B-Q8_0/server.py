from http.server import HTTPServer, BaseHTTPRequestHandler
import time
import json

class RateLimitedHandler(BaseHTTPRequestHandler):
    # Map IP -> list of timestamps
    rate_limit_data = {}

    def do_GET(self):
        client_ip = self.client_address[0]
        timestamps = self.rate_limit_data.get(client_ip, [])
        now = time.time()
        # Count requests within last 60 seconds
        count = sum(1 for ts in timestamps if now - ts <= 60.0)
        
        if count >= 5:
            # Rate limit exceeded
            self.send_response(429)
            # Compute Retry-After: time until oldest request leaves window
            if timestamps:
                oldest = min(timestamps)
                retry_after_seconds = int(oldest + 60.0 - now)
                if retry_after_seconds < 0:
                    retry_after_seconds = 0
            else:
                retry_after_seconds = 60
            self.send_header('Retry-After', str(retry_after_seconds))
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.writelines(json.dumps({"error": "Too Many Requests"}))
            return
        
        # Allowed: record timestamp
        timestamps.append(now)
        
        if self.path == '/api/time':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.writelines(json.dumps({"now": int(now)}))
        else:
            self.send_response(404)
            self.end_headers()
            self.writelines(json.dumps({"error": "Not found"}))

def run_server(port=8000):
    server = HTTPServer(('localhost', port), RateLimitedHandler)
    print(f"Server running on http://localhost:{port}")
    server.serve_forever()

if __name__ == '__main__':
    run_server()