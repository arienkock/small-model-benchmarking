import json
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', 8000))
HOST = '127.0.0.1'

books = []  # list of dicts, each with id, title, author, isbn, synopsis
next_id = 1

VALID_QUERY_PARAMS = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == '/books':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "invalid JSON"}).encode())
                return
            # validate required fields
            title = data.get('title')
            author = data.get('author')
            isbn = data.get('isbn')
            if title is None or author is None or isbn is None:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "missing required field"}).encode())
                return
            if not isinstance(title, str) or not isinstance(author, str) or not isinstance(isbn, str):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "type error"}).encode())
                return
            if not title or not author or not isbn:
                empty = []
                if not title: empty.append('title')
                if not author: empty.append('author')
                if not isbn: empty.append('isbn')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"{', '.join(empty)} is empty"}).encode())
                return
            book = {
                'id': next_id,
                'title': title,
                'author': author,
                'isbn': isbn,
                'synopsis': ''
            }
            books.append(book)
            next_id += 1
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
            return
        self.send_error(404, json.dumps({"error": "not found"}))

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        # validate query parameters
        unknown = set(query.keys()) - VALID_QUERY_PARAMS
        if unknown:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "unknown query parameter"}).encode())
            return
        if parsed.path == '/books':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = sorted(books, key=lambda b: b['id'])
            self.wfile.write(json.dumps(response).encode())
            return
        # /books/{id}
        try:
            path_parts = parsed.path.strip('/').split('/')
            if len(path_parts) != 2 or path_parts[0] != 'books':
                self.send_error(404, json.dumps({"error": "not found"}))
                return
            book_id_str = path_parts[1]
            try:
                book_id = int(book_id_str)
            except ValueError:
                self.send_error(404, json.dumps({"error": "not found"}))
                return
            book = next((b for b in books if b['id'] == book_id), None)
            if book is None:
                self.send_error(404, json.dumps({"error": "not found"}))
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
            return
        except Exception:
            self.send_error(404, json.dumps({"error": "not found"}))
            return

    def do_PUT(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == '/books':
            self.send_error(404, json.dumps({"error": "not found"}))
            return
        try:
            path_parts = parsed.path.strip('/').split('/')
            if len(path_parts) != 2 or path_parts[0] != 'books':
                self.send_error(404, json.dumps({"error": "not found"}))
                return
            book_id_str = path_parts[1]
            try:
                book_id = int(book_id_str)
            except ValueError:
                self.send_error(404, json.dumps({"error": "not found"}))
                return
        except Exception:
            self.send_error(404, json.dumps({"error": "not found"}))
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "invalid JSON"}).encode())
            return

        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        synopsis = data.get('synopsis', '')

        if title is None or author is None or isbn is None:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "missing required field"}).encode())
            return
        if not isinstance(title, str) or not isinstance(author, str) or not isinstance(isbn, str):
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "type error"}).encode())
            return
        if not title or not author or not isbn:
            empty = []
            if not title: empty.append('title')
            if not author: empty.append('author')
            if not isbn: empty.append('isbn')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"{', '.join(empty)} is empty"}).encode())
            return

        for book in books:
            if book['id'] == book_id:
                book['title'] = title
                book['author'] = author
                book['isbn'] = isbn
                book['synopsis'] = synopsis
                break

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

def run():
    server = HTTPServer((HOST, PORT), Handler)
    print(f'Serving on http://{HOST}:{PORT}')
    server.serve_forever()

if __name__ == '__main__':
    run()
