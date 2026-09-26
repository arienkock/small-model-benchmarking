import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}
next_id = 1

ALLOWED_PARAMS = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, data=None):
        body = json.dumps(data).encode() if data is not None else b''
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if body:
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def error(self, status, msg):
        self.send_json(status, {"error": msg})

    def read_json(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            length = 0
        if length == 0:
            self.error(400, "Missing body")
            return None
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self.error(400, "Invalid JSON")
            return None
        if not isinstance(data, dict):
            self.error(400, "Body must be a JSON object")
            return None
        return data

    def validate(self, data):
        for field in ('title', 'author', 'isbn'):
            val = data.get(field)
            if not isinstance(val, str) or len(val) == 0:
                self.error(400, f"{field} is required and must be a non-empty string")
                return None
        synopsis = data.get('synopsis', '')
        if not isinstance(synopsis, str):
            self.error(400, "synopsis must be a string")
            return None
        return True

    def parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path
        # Strip trailing slash for normalization, but keep /books intact
        while len(path) > 1 and path.endswith('/'):
            path = path[:-1]
        params = parse_qs(parsed.query, keep_blank_values=True)
        return path, params

    def do_GET(self):
        path, params = self.parse_path()
        if path == '/books':
            return self.list_books(params)
        if path.startswith('/books/'):
            id_str = path[7:]
            try:
                bid = int(id_str)
            except ValueError:
                return self.error(400, "id must be an integer")
            if bid not in books:
                return self.error(404, "Book not found")
            return self.send_json(200, books[bid])
        self.error(404, "Not found")

    def do_POST(self):
        path, _ = self.parse_path()
        if path != '/books':
            return self.error(404, "Not found")
        data = self.read_json()
        if data is None:
            return
        if 'id' in data:
            return self.error(400, "id must not be provided")
        if not self.validate(data):
            return
        global next_id
        bid = next_id
        next_id += 1
        book = {
            'id': bid,
            'title': data['title'],
            'author': data['author'],
            'isbn': data['isbn'],
            'synopsis': data.get('synopsis', ''),
        }
        books[bid] = book
        self.send_json(201, book)

    def do_PUT(self):
        path, _ = self.parse_path()
        if not path.startswith('/books/'):
            return self.error(404, "Not found")
        id_str = path[7:]
        try:
            bid = int(id_str)
        except ValueError:
            return self.error(400, "id must be an integer")
        if bid not in books:
            return self.error(404, "Book not found")
        data = self.read_json()
        if data is None:
            return
        if 'id' in data:
            return self.error(400, "id must not be provided")
        if not self.validate(data):
            return
        book = books[bid]
        book['title'] = data['title']
        book['author'] = data['author']
        book['isbn'] = data['isbn']
        book['synopsis'] = data.get('synopsis', '')
        self.send_json(200, book)

    def do_DELETE(self):
        path, _ = self.parse_path()
        if not path.startswith('/books/'):
            return self.error(404, "Not found")
        id_str = path[7:]
        try:
            bid = int(id_str)
        except ValueError:
            return self.error(400, "id must be an integer")
        if bid not in books:
            return self.error(404, "Book not found")
        del books[bid]
        self.send_response(204)
        self.end_headers()

    def list_books(self, params):
        for key in params:
            if key not in ALLOWED_PARAMS:
                return self.error(400, f"Unknown query parameter: {key}")
        results = list(books.values())
        if 'id' in params:
            try:
                target = int(params['id'][0])
            except ValueError:
                return self.error(400, "id must be an integer")
            results = [b for b in results if b['id'] == target]
        for field in ('title', 'author', 'isbn', 'synopsis'):
            if field in params:
                val = params[field][0].lower()
                results = [b for b in results if val in b[field].lower()]
        if 'q' in params:
            val = params['q'][0].lower()
            results = [b for b in results
                       if val in b['title'].lower() or
                          val in b['author'].lower() or
                          val in b['isbn'].lower() or
                          val in b['synopsis'].lower()]
        results.sort(key=lambda b: b['id'])
        self.send_json(200, results)

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    server = HTTPServer(('127.0.0.1', port), Handler)
    print(f"Listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
