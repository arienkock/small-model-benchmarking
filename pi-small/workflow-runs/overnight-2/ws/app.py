import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

class Handler(BaseHTTPRequestHandler):
    books = []
    next_id = 1

    def do_POST(self):
        if self.path != '/books':
            self.send_error(404)
            return
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length).decode())
        if not all(k in body for k in ('title', 'author', 'isbn')):
            self.send_error(400, json.dumps({"error": "missing required field"}))
            return
        if not body['title'].strip() or not body['author'].strip() or not body['isbn'].strip():
            self.send_error(400, json.dumps({"error": "title or author or isbn empty"}))
            return
        book = {
            'id': Handler.next_id,
            'title': body['title'],
            'author': body['author'],
            'isbn': body['isbn'],
            'synopsis': body.get('synopsis', '')
        }
        Handler.books.append(book)
        Handler.next_id += 1
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/books':
            # Only /books id filter for now (S6 error test)
            query = parse_qs(parsed.query)
            if 'id' in query:
                try:
                    book_id = int(query['id'][0])
                    books = [b for b in Handler.books if b['id'] == book_id]
                except ValueError:
                    self.send_error(400)
                    return
            else:
                books = Handler.books[:] 
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(books).encode())
        else:
            # GET /books/{id}
            parts = parsed.path.split('/')
            if len(parts) != 2 or parts[1] != 'books':
                self.send_error(404)
                return
            try:
                book_id = int(parts[1])
            except ValueError:
                self.send_error(404)
                return
            book = next((b for b in Handler.books if b['id'] == book_id), None)
            if book is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
    
    def do_PUT(self):
        if self.path != '/books':
            self.send_error(404)
            return
        parts = self.path.split('/')
        if len(parts) != 2 or parts[1] != 'books':
            self.send_error(404)
            return
        try:
            book_id = int(parts[1])
        except ValueError:
            self.send_error(400)
            return
        books = [b for b in Handler.books if b['id'] == book_id]
        if not books:
            self.send_error(404)
            return
        book = books[0]
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length).decode())
        # accept partial update
        if 'title' in body:
            book['title'] = body['title']
        if 'author' in body:
            book['author'] = body['author']
        if 'isbn' in body:
            book['isbn'] = body['isbn']
        if 'synopsis' in body:
            book['synopsis'] = body['synopsis']
        Handler.books[books.index(book)] = book
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if message:
            self.wfile.write(json.dumps(message).encode())
        else:
            self.wfile.write(json.dumps({"error": ""}).encode())

def run(port):
    server = HTTPServer(('127.0.0.1', port), Handler)
    server.serve_forever()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    run(port)
