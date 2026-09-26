import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(json.dumps(BOOKS).encode())))
            body = json.dumps(BOOKS).encode()
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def log_message(self, fmt, *args):
        # Custom log format for clarity (standard library only)
        super().log_message(fmt, *args)


HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
