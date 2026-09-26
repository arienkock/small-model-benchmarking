import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', 8000))
HOST = '127.0.0.1'

books = []          # list of dicts
next_id = 1

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self.send_error(404, json.dumps({"error": "not found"}))
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, json.dumps({"error": "invalid JSON"}))
            return

        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        # optional synopsis
        synopsis = data.get('synopsis', '')

        if not title or not author or not isbn:
            self.send_error(400, json.dumps({"error": "missing required field"}))
            return
        if not isinstance(title, str) or not isinstance(author, str) or not isinstance(isbn, str):
            self.send_error(400, json.dumps({"error": "type error"}))
            return
        if not title.strip() or not author.strip() or not isbn.strip():
            self.send_error(400, json.dumps({"error": "isbn is empty"}))
            return

        book = {
            'id': next_id,
            'title': title,
            'author': author,
            'isbn': isbn,
            'synopsis': synopsis
        }
        books.append(book)
        next_id += 1

        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        # known query params for /books
        known = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}
        unknown = set(query.keys()) - known
        if unknown:
            self.send_error(400, json.dumps({"error": "unknown query parameter"}))
            return

        if parsed.path == '/books':
            response = sorted(books, key=lambda b: b['id'])
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
            return

        # /books/{id}
        try:
            book_id = int(query['id'][0])
        except (KeyError, ValueError, IndexError):
            self.send_error(404, json.dumps({"error": "not found"}))
            return

        book = next((b for b in books if b['id'] == book_id), None)
        if book is None:
            self.send_error(404, json.dumps({"error": "book not found"}))
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())
        return

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self.send_error(404, json.dumps({"error": "not found"}))
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, json.dumps({"error": "invalid JSON"}))
            return

        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        synopsis = data.get('synopsis', '')

        if not title or not author or not isbn:
            self.send_error(400, json.dumps({"error": "missing required field"}))
            return
        if not isinstance(title, str) or not isinstance(author, str) or not isinstance(isbn, str):
            self.send_error(400, json.dumps({"error": "type error"}))
            return
        if not title.strip() or not author.strip() or not isbn.strip():
            self.send_error(400, json.dumps({"error": "isbn is empty"}))
            return

        book_id = int(data.get('id'))
        book = next((b for b in books if b['id'] == book_id), None)
        if book is None:
            self.send_error(404, json.dumps({"error": "book not found"}))
            return

        book['title'] = title
        book['author'] = author
        book['isbn'] = isbn
        book['synopsis'] = synopsis
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())
        return

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path != '/books':
            self.send_error(404, json.dumps({"error": "not found"}))
            return

        # find book id from query param
        book_id = int(parse_qs(self.path.split('?')[1]).get('id', [''])[0])
        book = next((b for b in books if b['id'] == book_id), None)
        if book is None:
            self.send_error(404, json.dumps({"error": "book not found"}))
            return

        books[:] = [b for b in books if b['id'] != book_id]
        self.send_response(204)
        self.end_headers()
        return

    def send_error(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(message).encode())

def run():
    server = HTTPServer((HOST, PORT), Handler)
    server.serve_forever()

if __name__ == '__main__':
    run()
