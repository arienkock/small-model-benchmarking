import json
from http.server import HTTPServer, BaseHTTPRequestHandler

BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Properly handle query strings - compare just the path part
        path = self.path.split('?')[0]
        if path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(BOOKS).encode()
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

# Use allow_reuse_address to handle rapid port reuse
class ReuseHTTPServer(HTTPServer):
    allow_reuse_address = True

ReuseHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
