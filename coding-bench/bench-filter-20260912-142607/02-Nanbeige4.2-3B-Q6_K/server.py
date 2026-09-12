#!/usr/bin/env python3
"""Rate-limited HTTP API server using only the Python standard library."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
from collections import defaultdict
import json
from threading import Lock


class APIHandler(BaseHTTPRequestHandler):
    """Handler for /api/time with per-client rate limiting (5 req/60s by IP)."""

    MAX_PER_WINDOW = 5
    WINDOW_SECONDS = 60

    # Per-client rate limit window store: ip -> list of timestamps (sorted)
    client_windows: dict[str, list[float]] = defaultdict(list)
    # Lock to protect concurrent writes to client_windows
    lock = Lock()

    def _get_client_window(self) -> list[float]:
        """Return the current rate-limit window timestamps for this client IP."""
        client_ip = self.client_address[0]
        with self.lock:
            return self.client_windows[client_ip]

    def _remove_old(self, client_ip: str) -> None:
        """Remove timestamps older than the current window."""
        cutoff = datetime.now(timezone.utc).timestamp() - self.WINDOW_SECONDS
        with self.lock:
            self.client_windows[client_ip] = [
                ts for ts in self.client_windows[client_ip] if ts >= cutoff
            ]

    def _is_rate_limited(self, client_ip: str) -> tuple[bool, int | None]:
        """Check if the client is rate-limited. Return (limited, retry_after) or (False, None)."""
        now = datetime.now(timezone.utc).timestamp()
        with self.lock:
            window = self.client_windows[client_ip]
            self._remove_old(client_ip)
            if len(window) >= self.MAX_PER_WINDOW:
                # Compute Retry-After: how many seconds until the oldest entry expires
                oldest = window[0]
                retry_after = max(1, int(oldest + self.WINDOW_SECONDS - now))
                return True, retry_after
        return False, None

    def do_GET(self):
        if self.path == "/api/time":
            client_ip = self.client_address[0]
            limited, retry_after = self._is_rate_limited(client_ip)
            if limited:
                self.send_response(429)
                self.send_header("Retry-After", retry_after)
                self.end_headers()
                return

            now = int(datetime.now(timezone.utc).timestamp())
            payload = json.dumps({"now": now}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    # Need json module — import it explicitly
    import json

    def log_message(self, fmt, *args):
        # Suppress default logging to keep output clean
        pass


def run(port: int = 8080):
    server = HTTPServer(("0.0.0.0", port), APIHandler)
    print(f"Server running on http://0.0.0.0:{port}/api/time (rate limit: 5 req/60s per IP)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    run()
