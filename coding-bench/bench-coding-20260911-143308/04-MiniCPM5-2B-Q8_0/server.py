import json
from http.server import HTTPServer, BaseHTTPRequestHandler

BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(BOOKS).encode()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()

HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
