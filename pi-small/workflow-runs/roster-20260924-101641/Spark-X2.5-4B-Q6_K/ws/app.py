"""RESTful HTTP API for books.

A book has fields: id (int), title (str), author (str), isbn (str),
synopsis (str, optional, defaults to '').

Data is kept in memory. The server listens on 127.0.0.1, port from the
PORT environment variable (default 8000).
"""

import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class Book:
    """A book record."""

    def __init__(self, book_id, title, author, isbn, synopsis=""):
        self.id = book_id
        self.title = title
        self.author = author
        self.isbn = isbn
        self.synopsis = synopsis

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "author": self.author,
            "isbn": self.isbn,
            "synopsis": self.synopsis,
        }


class BookStore:
    """Thread-safe in-memory store of books with auto-incrementing ids."""

    def __init__(self):
        self._lock = threading.Lock()
        self._books = []
        self._next_id = 1

    def create(self, title, author, isbn, synopsis=""):
        with self._lock:
            book = Book(self._next_id, title, author, isbn, synopsis)
            self._books.append(book)
            self._next_id += 1
            return book

    def get(self, book_id):
        with self._lock:
            for book in self._books:
                if book.id == book_id:
                    return book
            return None

    def list(self):
        with self._lock:
            return list(self._books)

    def delete(self, book_id):
        with self._lock:
            for i, book in enumerate(self._books):
                if book.id == book_id:
                    del self._books[i]
                    return True
            return False


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class BookHandler(BaseHTTPRequestHandler):
    store = None
    _content_length = None

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json(status, {"error": message})

    def _send_no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()
        self.wfile.write(b"")

    def _read_body(self):
        try:
            length = int(self._content_length) if self._content_length is not None else 0
            raw = self.rfile.read(length) if length > 0 else b""
            if not raw:
                return None, None
            return json.loads(raw), None
        except (ValueError, json.JSONDecodeError):
            return None, self._send_error(400, "Invalid JSON body")

    def _parse_path(self):
        parsed = urlparse(self.path)
        segments = [seg for seg in parsed.path.split("/") if seg]
        if len(segments) < 2 or segments[0] != "books":
            return None, self._send_error(404, "Not found")
        if len(segments) == 2:
            return segments, None
        return segments, None

    def _parse_path_id(self, path_id):
        try:
            return int(path_id), None
        except (ValueError, TypeError):
            return None, self._send_error(400, "Path id must be an integer")

    def _validate_book_payload(self, payload):
        if not isinstance(payload, dict):
            return None, self._send_error(400, "Request body must be a JSON object")

        if "id" in payload:
            return None, self._send_error(400, "id must not be supplied in the request body")

        title = payload.get("title")
        author = payload.get("author")
        isbn = payload.get("isbn")
        synopsis = payload.get("synopsis", "")

        if not isinstance(title, str) or not title.strip():
            return None, self._send_error(400, "title is required and must be a non-empty string")
        if not isinstance(author, str) or not author.strip():
            return None, self._send_error(400, "author is required and must be a non-empty string")
        if not isinstance(isbn, str) or not isbn.strip():
            return None, self._send_error(400, "isbn is required and must be a non-empty string")
        if not isinstance(synopsis, str):
            return None, self._send_error(400, "synopsis must be a string")

        return {
            "title": title,
            "author": author,
            "isbn": isbn,
            "synopsis": synopsis,
        }, None

    def _handle_get_books_list(self):
        """GET /books — list all books ordered by id with optional filters."""
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        allowed_fields = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in query:
            if key not in allowed_fields:
                return self._send_error(400, f"Unknown query parameter: {key}")

        store = self.store
        books = store.list()

        if "id" in query:
            ids = query["id"]
            if len(ids) != 1:
                return self._send_error(400, "id query parameter must be a single value")
            book_id = int(ids[0])
            books = [b for b in books if b.id == book_id]

        for field in ("title", "author", "isbn", "synopsis"):
            if field in query:
                values = query[field]
                if len(values) != 1:
                    return self._send_error(400, f"{field} query parameter must be a single value")
                needle = values[0].lower()
                books = [b for b in books if getattr(b, field).lower() == needle]

        if "q" in query:
            values = query["q"]
            if len(values) != 1:
                return self._send_error(400, "q query parameter must be a single value")
            needle = values[0].lower()
            books = [
                b for b in books
                if any(getattr(b, f).lower() == needle for f in ("title", "author", "isbn", "synopsis"))
            ]

        self._send_json(200, {"books": [b.to_dict() for b in books]})

    def _handle_get_book(self, segments):
        """GET /books/{id} — return a single book or 404."""
        path_id, err = self._parse_path_id(segments[1])
        if err:
            return

        book = self.store.get(path_id)
        if book is None:
            return self._send_error(404, "Book not found")

        self._send_json(200, book.to_dict())

    def _handle_post_books(self):
        """POST /books — create a new book."""
        path, err = self._parse_path()
        if err:
            return

        payload, err = self._read_body()
        if err:
            return

        validated, err = self._validate_book_payload(payload)
        if err:
            return

        book = self.store.create(**validated)
        self._send_json(201, book.to_dict())

    def _handle_put_book(self, segments):
        """PUT /books/{id} — update an existing book."""
        path_id, err = self._parse_path_id(segments[1])
        if err:
            return

        book = self.store.get(path_id)
        if book is None:
            return self._send_error(404, "Book not found")

        payload, err = self._read_body()
        if err:
            return

        validated, err = self._validate_book_payload(payload)
        if err:
            return

        # Only the fields present in the payload are updated.
        book.title = validated["title"]
        book.author = validated["author"]
        book.isbn = validated["isbn"]
        book.synopsis = validated["synopsis"]

        self._send_json(200, book.to_dict())

    def _handle_delete_book(self, segments):
        """DELETE /books/{id} — delete a book. 204 on success."""
        path_id, err = self._parse_path_id(segments[1])
        if err:
            return

        if not self.store.delete(path_id):
            return self._send_error(404, "Book not found")

        self._send_no_content()


# ---------------------------------------------------------------------------
# Request routing
# ---------------------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/books":
            return self._handle_get_books_list()
        if path.startswith("/books/"):
            # /books/{id}
            segments = [s for s in path.split("/")[1:] if s != ""]
            if len(segments) == 1:
                return self._handle_get_book(segments)
            return self._send_error(404, "Not found")
        return self._send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/books":
            return self._handle_post_books()
        return self._send_error(404, "Not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/books/"):
            segments = [s for s in path.split("/")[1:] if s != ""]
            if len(segments) == 1:
                return self._handle_put_book(segments)
            return self._send_error(404, "Not found")
        return self._send_error(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/books/"):
            segments = [s for s in path.split("/")[1:] if s != ""]
            if len(segments) == 1:
                return self._handle_delete_book(segments)
            return self._send_error(404, "Not found")
        return self._send_error(404, "Not found")

    def log_message(self, fmt, *args):
        # Silence default logging to keep test output clean.
        pass


# ---------------------------------------------------------------------------
# Server entry point
# ---------------------------------------------------------------------------


def make_server(store):
    """Create an HTTPServer with the book handler bound to the store."""
    handler = BookHandler
    handler.store = store

    def handler_factory():
        return handler

    return HTTPServer(("127.0.0.1", _get_port()), handler_factory)


def _get_port():
    port_env = os.environ.get("PORT", "8000")
    try:
        port = int(port_env)
    except ValueError:
        return 8000
    return port


def main():
    store = BookStore()
    server = make_server(store)
    port = _get_port()
    server.server_address = ("127.0.0.1", port)
    # Re-create the server with the final port and store.
    server = make_server(store)
    server.server_address = ("127.0.0.1", port)
    server.serve_forever()


if __name__ == "__main__":
    main()
