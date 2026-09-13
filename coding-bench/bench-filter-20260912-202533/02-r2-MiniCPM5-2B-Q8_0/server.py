import json
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from collections import defaultdict


RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW_MS = 60 * 1000


_clients = defaultdict(list)
_clients_lock = threading.Lock()


class TimeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        client_ip = self.client_address[0]
        now = time.time()

        with _clients_lock:
            timestamps = _clients[client_ip]
            timestamps[:] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW_MS]
            if len(timestamps) >= RATE_LIMIT_MAX:
                self.send_response(429)
                self.send_header("Retry-After", str(int(RATE_LIMIT_WINDOW_MS / 1000.0)))
                self.end_headers()
                return
            timestamps.append(now)

        if self.path == "/api/time":
            now_ts = int(time.time())
            body = json.dumps({"now": now_ts}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8000), TimeHandler)
    print("Serving on port 8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
