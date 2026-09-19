import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 60

# Per-client request timestamps, keyed by client IP.
_request_times = {}


class TimeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/time":
            self.handle_time()
        else:
            self.send_error(404)

    def handle_time(self):
        client_ip = self.client_address[0]
        now = time.time()

        # Sliding window: keep only timestamps from the last RATE_WINDOW_SECONDS.
        timestamps = _request_times.get(client_ip, [])
        cutoff = now - RATE_WINDOW_SECONDS
        timestamps = [t for t in timestamps if t >= cutoff]

        if len(timestamps) >= RATE_LIMIT:
            # 6th and further requests within the window -> 429.
            oldest = timestamps[0]
            retry_after = RATE_WINDOW_SECONDS - (now - oldest)
            self.send_response(429)
            self.send_header("Retry-After", str(int(retry_after)))
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": "rate limit exceeded"}).encode("utf-8")
            )
            return

        timestamps.append(now)
        _request_times[client_ip] = timestamps

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"now": int(now)}).encode("utf-8"))

    def log_message(self, fmt, *args):  # silence default logging
        pass


def main():
    server = ThreadingHTTPServer(("0.0.0.0", 8000), TimeHandler)
    print("Rate-limited API server listening on http://0.0.0.0:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
