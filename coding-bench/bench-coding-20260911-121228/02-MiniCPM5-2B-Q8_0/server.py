import http.server
import json
import os
import random
import string
import re


def generate_code(length=6):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


# In-memory storage: code -> url
storage = {}

class Handler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/shorten":
            self.send_error(404)
            return
        length = 6
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            data = json.loads(body.decode())
            url = data["url"]
            code = generate_code(length)
            storage[code] = url
            self._send_json(code, {"code": code, "url": url})
        except Exception:
            self.send_error(400)

    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"URL shortener server")
            return
        # Extract code from path like /<code>
        match = re.match(r"^/([A-Za-z0-9]{6})$", self.path)
        if match:
            code = match.group(1)
            if code in storage:
                self.send_response(302)
                self.send_header("Location", storage[code])
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_error(404)


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", 8080), Handler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()
