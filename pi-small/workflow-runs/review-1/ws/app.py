#!/usr/bin/env python3
import json
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookHandler(BaseHTTPRequestHandler):
    books = []
    next_id = 1

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path != "/books":
            self.send_error(404)
            return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "empty body")
            return

        try:
            data = json.loads(self.rfile.read(content_length))
        except json.JSONDecodeError:
            self.send_error(400, "invalid JSON")
            return

        if not isinstance(data, dict):
            self.send_error(400, "body must be JSON object")
            return

        if 'id' in data:
            self.send_error(400, "id")
            return

        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        synopsis = data.get('synopsis', '')

        # Validate required fields
        for field, value in (('title', title), ('author', author), ('isbn', isbn)):
            if value is None:
                self.send_error(400, f"{field} is missing")
                return
            if not isinstance(value, str):
                self.send_error(400, f"{field} must be a string")
                return
            if value.strip() == '':
                self.send_error(400, f"{field} is empty")
                return

        book = {
            'id': BookHandler.next_id,
            'title': title,
            'author': author,
            'isbn': isbn,
            'synopsis': synopsis
        }
        BookHandler.books.append(book)
        BookHandler.next_id += 1
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/books":
            self.do_GET_all()
            return
        if path.startswith("/books/"):
            try:
                book_id = int(path.split('/')[-1])
            except ValueError:
                self.send_error(400, "id in path must be an integer")
                return
            self.do_GET_one(book_id)
            return

        self.send_error(404)

    def do_GET_one(self, book_id):
        book = next((b for b in BookHandler.books if b['id'] == book_id), None)
        if not book:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_GET_all(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        filters = {}
        for k, v in qs.items():
            if k in ('id', 'title', 'author', 'isbn', 'synopsis', 'q'):
                filters[k] = v[0].lower()
        allowed = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}
        for k in qs.keys():
            if k not in allowed:
                self.send_error(400, "unknown query parameter")
                return

        # Apply filters
        # id filter
        if 'id' in filters:
            id_val = int(filters['id'])
            books = [b for b in BookHandler.books if b['id'] == id_val]
        else:
            books = BookHandler.books[:]
        # other filters: must be case-insensitive substring
        for field, val in filters.items():
            if field == 'q':
                # q is generic search: check any of title, author, isbn, synopsis
                if not books:
                    break
                books = [b for b in books if any(val in b[f].lower() for f in
                                                     ('title', 'author', 'isbn', 'synopsis'))]
            elif field in ['title', 'author', 'isbn', 'synopsis']:
                books = [b for b in books if val in b[field].lower()]

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(books).encode())

    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        error_msg = {"error": message or "error"}
        self.wfile.write(json.dumps(error_msg).encode())

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/books"):
            self.send_error(404)
            return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "empty body")
            return

        try:
            data = json.loads(self.rfile.read(content_length))
        except json.JSONDecodeError:
            self.send_error(400, "invalid JSON")
            return

        if not isinstance(data, dict):
            self.send_error(400, "body must be JSON object")
            return

        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        synopsis = data.get('synopsis', '')
        if 'id' in data:
            self.send_error(400, "id")
            return
        if not title or not author or not isbn:
            self.send_error(400, "missing required field")
            return
        if not title.strip() or not author.strip() or not isbn.strip():
            self.send_error(400, "title/author/isbn empty")
            return

        try:
            book_id = int(path.split('/')[-1])
        except ValueError:
            self.send_error(400, "id in path must be an integer")
            return

        book = next((b for b in BookHandler.books if b['id'] == book_id), None)
        if not book:
            self.send_error(404)
            return

        book['title'] = title
        book['author'] = author
        book['isbn'] = isbn
        book['synopsis'] = synopsis

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/books"):
            self.send_error(404)
            return

        try:
            book_id = int(path.split('/')[-1])
        except ValueError:
            self.send_error(400, "id in path must be an integer")
            return

        book = next((b for b in BookHandler.books if b['id'] == book_id), None)
        if not book:
            self.send_error(404)
            return
        BookHandler.books.remove(book)
        self.send_response(204)
        self.end_headers()


def make_server(port):
    server = HTTPServer(('127.0.0.1', port), BookHandler)
    return server

if __name__ == '__main__':
    import os
    port = int(os.getenv('PORT', 8000))
    server = make_server(port)
    server.serve_forever()
