#!/usr/bin/env python3
"""Token-based login API server using only the Python standard library."""

import json
import base64
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Simple in-memory user store (for demo purposes)
# In a real app, this would be a database
USERS = {"alice": "alice", "bob": "bob"}


def create_token(user: str) -> str:
    """Create a base64-encoded token containing user and expiration."""
    payload = {"user": user, "exp": int(time.time()) + 3600}
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8"))
    return encoded.decode("utf-8")


def decode_token(token: str) -> dict | None:
    """Decode a base64-encoded token and return the payload dict."""
    try:
        decoded = base64.b64decode(token).decode("utf-8")
        payload = json.loads(decoded)
        return payload
    except (base64.binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        return None


class LoginHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/login":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return

            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                user = data.get("user")
                if not user or not isinstance(user, str):
                    self.send_response(400)
                    self.end_headers()
                    return
            except (json.JSONDecodeError, ValueError):
                self.send_response(400)
                self.end_headers()
                return

            token = create_token(user)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(token.encode("utf-8"))

        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/me":
            auth_header = self.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                self.send_response(401)
                self.end_headers()
                return

            token = auth_header[7:]  # Strip "Bearer "
            payload = decode_token(token)
            if payload is None or "user" not in payload:
                self.send_response(401)
                self.end_headers()
                return

            # Check expiration
            exp = payload.get("exp")
            if exp is None or int(time.time()) > exp:
                self.send_response(401)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"user": payload["user"]}).encode("utf-8"))

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), LoginHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()

if __name__ == "__main__":
    main()
