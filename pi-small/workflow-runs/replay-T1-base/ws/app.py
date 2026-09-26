import json
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urllibllib

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
                self.send_error(400, json.dumps({"error": "invalid JSON"}))
                return
            # validate required fields
            title = data.get('title')
            author = data.get('author')
            isbn = data.get('isbn')
            if not (title and author and isbn):
                self.send_error(400, json.dumps({"error": "missing required field"}))
                return
            if not title or not author or not isbn:
                self.send_error(400, json.dumps({"error": "field is empty"}))
                return
            if not isinstance(title, str) or not isinstance(author, str) or not isinstance(isbn, str):
                self.send_error(400, json.dumps({"error": "type error"}))
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
            self.send_error(400, json.dumps({"error": "unknown query parameter"}))
            return
        if parsed.path == '/books':
            # search/filter not implemented yet (T3)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            # return all books ordered by id
            response = sorted(books, key=lambda b: b['id'])
            self.wfile.write(json.dumps(response).encode())
            return
        # /books/{id}
        try:
            book_id = int(query['id'][0])
        except (KeyError, ValueError, IndexError):
            self.send_error(404, json.dumps({"error": "missing id"}))
            return
        book = next((b for b in books if b['id'] == book_id), None)
        if book is None:
            self.send_error(404, json.dumps({"error": "book not found"}))
            return
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
