import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # self.path includes the query string (e.g. "/api/books?x=1"),
        # so strip it before matching the endpoint.
        path = urlparse(self.path).path

        if path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(BOOKS).encode()
            # Content-Length must be set so clients can read the body.
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
