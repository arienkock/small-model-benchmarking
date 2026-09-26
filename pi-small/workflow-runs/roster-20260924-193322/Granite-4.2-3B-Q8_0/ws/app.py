import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket

class BookHandler(BaseHTTPRequestHandler):
    books = []
    next_id = 1
    lock = threading.Lock()

    def do_post(self):
        data = json.loads(self.rfile.read().decode())
        if not all(k in data for k in ("title", "author", "isbn")):
            self.send_error(400, "Missing required field")
            return
        # POST /books creates book
        book = {
            "id": BookHandler.next_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": ""
        }
        with BookHandler.lock:
            BookHandler.books.append(book)
            BookHandler.next_id += 1
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_get(self, book_id_path):
        # book_id_path is like "/books/2"
        try:
            book_id = int(book_id_path.split("/")[-1])
        except ValueError:
            self.send_error(400, "Invalid id")
            return
        with BookHandler.lock:
            book = next((b for b in BookHandler.books if b["id"] == book_id), None)
        if book is None:
            self.send_error(404, "Book not found")
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def do_put(self, book_id_path):
        # book_id_path is like "/books/2"
        try:
            book_id = int(book_id_path.split("/")[-1])
        except ValueError:
            self.send_error(400, "Invalid id")
            return
        data = json.loads(self.rfile.read().decode())
        # At least keep title, author, isbn; synopsis optional
        if not all(k in data for k in ("title", "author", "isbn")):
            self.send_error(400, "Missing required field")
            return
        with BookHandler.lock:
            book = next((b for b in BookHandler.books if b["id"] == book_id), None)
            if book is None:
                self.send_error(404, "Book not found")
                return
            # Update fields
            book.update(data)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(book).encode())

    def send_error(self, code, message=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        error_obj = {"error": message if message else "Internal server error"}
        self.wfile.write(json.dumps(error_obj).encode())

if __name__ == "__main__":
    server = ThreadingHTTPServer(('127.0.0.1', 8000), BookHandler)
    server.serve_forever()
