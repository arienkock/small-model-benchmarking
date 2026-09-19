import json
from http.server import HTTPServer, BaseHTTPRequestHandler

BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Normalize path to handle trailing slashes consistently
        path = self.path.rstrip('/')
        if path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(BOOKS).encode()
            content_length = len(body)
            self.send_header("Content-Length", str(content_length))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
