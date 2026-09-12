#!/usr/bin/env python3
import json
import base64
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

class LoginHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/login':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode())
                user = data['user']
                exp = int(time.time()) + 3600
                payload = {"user": user, "exp": exp}
                token = base64.b64encode(json.dumps(payload).encode()).decode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"token": token}).encode())
            except Exception:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/api/me':
            auth = self.headers.get('Authorization', '')
            if auth.startswith('Bearer '):
                token = auth[7:]
                try:
                    decoded = base64.b64decode(token.encode())
                    payload = json.loads(decoded.decode())
                    if payload.get('exp', 0) > time.time():
                        user = payload['user']
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({"user": user}).encode())
                    else:
                        self.send_response(401)
                        self.end_headers()
                except Exception:
                    self.send_response(401)
                    self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

def main():
    server = HTTPServer(('', 8080), LoginHandler)
    print('Server running on http://localhost:8080')
    server.serve_forever()

if __name__ == '__main__':
    main()
