#!/usr/bin/env python3
"""Token-based login API server using only Python standard library."""

import base64
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Secret key for base64 encoding (in production, use a proper secret)
SECRET_KEY = b"secret-key-for-base64-encoding"


def encode_token(user: str) -> str:
    """Encode user info into a base64 token."""
    payload = json.dumps({"user": user, "exp": int(time.time() + 3600)})
    return base64.b64encode(payload.encode()).decode()


def decode_token(token: str) -> dict | None:
    """Decode a base64 token and return the payload dict, or None on failure."""
    try:
        decoded = base64.b64decode(token).decode()
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
            body = self.rfile.read(content_length).decode()
            try:
                data = json.loads(body)
                user = data.get("user")
                if not user or not isinstance(user, str):
                    self.send_response(400)
                    self.end_headers()
                    return
            except (json.JSONDecodeError, KeyError):
                self.send_response(400)
                self.end_headers()
                return

            token = encode_token(user)
            self.send_response(200)
            self.set_header("Content-Type", "application/json")
            self.end_headers()
            response = {"token": token}
            self.wfile.write(json.dumps(response).encode())
        else:
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
            if "exp" in payload and payload["exp"] < int(time.time()):
                self.send_response(401)
                self.end_headers()
                return
            self.send_response(200)
            self.set_header("Content-Type", "application/json")
            self.end_headers()
            response = {"user": payload["user"]}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default log messages
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), LoginHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()

if __name__ == "__main__":
    main()
