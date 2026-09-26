import json
import sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = []

class BookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
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
            title = data.get('title')
            author = data.get('author')
            isbn = data.get('isbn')
            if not title or not author or not isbn:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "missing required field"}).encode())
                return
            if not title.strip() or not author.strip() or not isbn.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "empty field"}).encode())
                return
            book = {
                'id': len(books) + 1,
                'title': title.strip(),
                'author': author.strip(),
                'isbn': isbn.strip(),
                'synopsis': data.get('synopsis', '')
            }
            books.append(book)
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
            return
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Not found"}).encode())

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/books':
            params = parse_qs(parsed.query)
            q = params.get('id')
            if q and q[0].isdigit():
                book_id = int(q[0])
                for book in books:
                    if book['id'] == book_id:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps(book).encode())
                        return
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Book not found"}).encode())
                return
            else:
                books_sorted = sorted(books, key=lambda b: b['id'])
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(books_sorted).encode())
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())

def make_server(port):
    server = ThreadingHTTPServer(('127.0.0.1', port), BookHandler)
    return server
