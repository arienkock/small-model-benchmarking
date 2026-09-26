import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import os

books = {}
next_id = 1

def get_book(id):
    return books.get(int(id))
    global next_id

def create_book(data):
    global next_id
    if not isinstance(data, dict):
        raise ValueError('Body must be a JSON object')
    title = data.get('title')
    author = data.get('author')
    isbn = data.get('isbn')
    synopsis = data.get('synopsis', '')
    if not isinstance(title, str) or not title:
        raise ValueError('Missing required field: title')
    if not isinstance(author, str) or not author:
        raise ValueError('Missing required field: author')
    if not isinstance(isbn, str) or not isbn:
        raise ValueError('Missing required field: isbn')
    book = {
        'id': next_id,
        'title': title,
        'author': author,
        'isbn': isbn,
        'synopsis': synopsis
    }
    books[next_id] = book
    next_id += 1
    return book

def read_book(id):
    book = get_book(id)
    if book is None:
        raise ValueError('Book not found')
    return book

def update_book(id, data):
    global next_id
    if not isinstance(data, dict):
        raise ValueError('Body must be a JSON object')
    if 'title' not in data or not isinstance(data['title'], str) or not data['title']:
        raise ValueError('Missing required field: title')
    if 'author' not in data or not isinstance(data['author'], str) or not data['author']:
        raise ValueError('Missing required field: author')
    if 'isbn' not in data or not isinstance(data['isbn'], str) or not data['isbn']:
        raise ValueError('Missing required field: isbn')
    book = books.get(id)
    if book is None:
        raise ValueError('Book not found')
    book['title'] = data['title']
    book['author'] = data['author']
    book['isbn'] = data['isbn']
    return book

def delete_book(id):
    global next_id
    if id not in books:
        raise ValueError('Book not found')
    del books[id]


    @classmethod
    def _start_server(cls):
        """Start the HTTP server on port 8000 in a background thread."""
        import os
        os.environ["PORT"] = "8000"
        server = HTTPServer("127.0.0.1", 8000, BookHandler)
        cls.server = server
        server.serve_forever()

class BookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/books":
            books_list = sorted(books.values(), key=lambda b: b["id"])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(books_list).encode())
        elif self.path.startswith("/books/"):
            try:
                id = int(self.path.split("/")[-1])
                book = read_book(id)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(book).encode())
            except (ValueError, KeyError):
                self.send_error(404, "Book not found")
        else:
            self.send_error(404, "Not found")
    def do_POST(self):
        if self.path == "/books":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_error(400, "Empty body")
                return
            try:
                body = json.loads(self.rfile.read(content_length))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            try:
                book = create_book(body)
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(book).encode())
            except ValueError as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404, "Not found")
    def do_PUT(self):
        if self.path.startswith("/books/"):
            try:
                id = int(self.path.split("/")[-1])
            except ValueError:
                self.send_error(400, "Invalid ID")
                return
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_error(400, "Empty body")
                return
            try:
                body = json.loads(self.rfile.read(content_length))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            try:
                book = update_book(id, body)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(book).encode())
            except ValueError as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404, "Not found")
    def do_DELETE(self):
        if self.path.startswith("/books/"):
            try:
                id = int(self.path.split("/")[-1])
            except ValueError:
                self.send_error(400, "Invalid ID")
                return
            try:
                delete_book(id)
                self.send_response(204)
                self.end_headers()
            except ValueError as e:
                self.send_error(404, str(e))
        else:
            self.send_error(404, "Not found")
    def log_message(self, format, *args):
        pass

def run_server(port=8000):
    os.environ["PORT"] = str(port)
    server = HTTPServer("127.0.0.1", port, BookHandler)
    print(f"Server starting on port {port}")
    server.serve_forever()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    run_server(port)
