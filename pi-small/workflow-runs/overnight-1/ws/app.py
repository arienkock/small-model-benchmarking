import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookHandler(BaseHTTPRequestHandler):
    books = []
    next_id = 1

    def _send_json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())

    def _send_no_content(self, code=204):
        self.send_response(code)
        self.end_headers()

    def _parse_path(self, path):
        parts = path.split('/')
        if len(parts) != 3 or parts[1] != 'books':
            return None
        return parts[2]

    def do_post(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self._send_error(404, "Not Found")
            return
        try:
            data = json.loads(self.rfile.read().decode())
        except Exception:
            self._send_error(400, "invalid JSON")
            return
        if not isinstance(data, dict):
            self._send_error(400, "body must be JSON object")
            return
        errors = []
        for field in ('title', 'author', 'isbn'):
            val = data.get(field)
            if val is None:
                errors.append(f"{field} is missing")
            elif not isinstance(val, str) or not val.strip():
                errors.append(f"{field} is empty")
        if errors:
            self._send_error(400, "; ".join(errors))
            return
        if 'id' in data:
            self._send_error(400, '"id" in body')
            return
        book = {
            'id': BookHandler.next_id,
            'title': data['title'].strip(),
            'author': data['author'].strip(),
            'isbn': data['isbn'].strip(),
            'synopsis': ''
        }
        BookHandler.books.append(book)
        BookHandler.next_id += 1
        response = {
            'id': book['id'],
            'title': book['title'],
            'author': book['author'],
            'isbn': book['isbn'],
            'synopsis': book['synopsis']
        }
        self._send_json(201, response)
        return

    def do_get(self):
        parsed = urlparse(self.path)
        if parsed.path == '/books':
            self._send_json(200, BookHandler.books)
            return
        path = self._parse_path(parsed.path)
        if path is None:
            self._send_error(404, "Not Found")
            return
        try:
            book_id = int(path)
        except ValueError:
            self._send_error(404, "Not Found")
            return
        book = next((b for b in BookHandler.books if b['id'] == book_id), None)
        if book is None:
            self._send_error(404, "Book not found")
            return
        self._send_json(200, book)
        return

    def do_put(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self._send_error(404, "Not Found")
            return
        path = self._parse_path(parsed.path)
        if path is None:
            self._send_error(404, "Not Found")
            return
        try:
            book_id = int(path)
        except ValueError:
            self._send_error(404, "Not Found")
            return
        try:
            data = json.loads(self.rfile.read().decode())
        except Exception:
            self._send_error(400, "invalid JSON")
            return
        if not isinstance(data, dict):
            self._send_error(400, "body must be JSON object")
            return
        errors = []
        for field in ('title', 'author', 'isbn'):
            val = data.get(field)
            if val is None:
                errors.append(f"{field} is missing")
            elif not isinstance(val, str) or not val.strip():
                errors.append(f"{field} is empty")
        if errors:
            self._send_error(400, "; ".join(errors))
            return
        if 'id' in data:
            self._send_error(400, '"id" in body')
            return
        book = {
            'id': BookHandler.next_id,
            'title': data['title'].strip(),
            'author': data['author'].strip(),
            'isbn': data['isbn'].strip(),
            'synopsis': data.get('synopsis', '').strip() if data.get('synopsis') is not None else ''
        }
        BookHandler.books.append(book)
        BookHandler.next_id += 1
        response = {
            'id': book['id'],
            'title': book['title'],
            'author': book['author'],
            'isbn': book['isbn'],
            'synopsis': book['synopsis']
        }
        self._send_json(200, response)
        return

    def do_delete(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self._send_error(404, "Not Found")
            return
        path = self._parse_path(parsed.path)
        if path is None:
            self._send_error(404, "Not Found")
            return
        try:
            book_id = int(path)
        except ValueError:
            self._send_error(404, "Not Found")
            return
        book = next((b for b in BookHandler.books if b['id'] == book_id), None)
        if book is None:
            self._send_error(404, "Book not found")
            return
        BookHandler.books.remove(book)
        self._send_no_content()


def run(port=8000):
    server = HTTPServer(('127.0.0.1', port), BookHandler)
    server.serve_forever()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    run(port)
