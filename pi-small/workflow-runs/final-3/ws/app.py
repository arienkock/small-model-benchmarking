import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self._books = {}
        self._next_id = 1
        self._lock = threading.Lock()

    def create(self, title, author, isbn, synopsis=""):
        with self._lock:
            book = {
                "id": self._next_id,
                "title": title,
                "author": author,
                "isbn": isbn,
                "synopsis": synopsis,
            }
            self._books[book["id"]] = book
            self._next_id += 1
            return book

    def get(self, book_id):
        with self._lock:
            return self._books.get(book_id)

    def update(self, book_id, title, author, isbn, synopsis=""):
        with self._lock:
            if book_id not in self._books:
                return None
            book = {
                "id": book_id,
                "title": title,
                "author": author,
                "isbn": isbn,
                "synopsis": synopsis,
            }
            self._books[book_id] = book
            return book

    def delete(self, book_id):
        with self._lock:
            if book_id in self._books:
                del self._books[book_id]
                return True
            return False

    def list_books(self, params):
        with self._lock:
            results = list(self._books.values())

        for key, value in params.items():
            if key == "id":
                try:
                    target_id = int(value[0])
                except (ValueError, IndexError):
                    return None, "Invalid id parameter"
                results = [b for b in results if b["id"] == target_id]
            elif key == "title":
                lower_val = value[0].lower()
                results = [b for b in results if lower_val in b["title"].lower()]
            elif key == "author":
                lower_val = value[0].lower()
                results = [b for b in results if lower_val in b["author"].lower()]
            elif key == "isbn":
                lower_val = value[0].lower()
                results = [b for b in results if lower_val in b["isbn"].lower()]
            elif key == "synopsis":
                lower_val = value[0].lower()
                results = [b for b in results if lower_val in b["synopsis"].lower()]
            elif key == "q":
                lower_val = value[0].lower()
                results = [b for b in results if any(
                    lower_val in b[field].lower()
                    for field in ("title", "author", "isbn", "synopsis")
                )]
            else:
                return None, f"Unknown query parameter: {key}"

        results.sort(key=lambda b: b["id"])
        return results, None


store = BookStore()


def validate_book_fields(data, check_id=False):
    if not isinstance(data, dict):
        return "Request body must be a JSON object"
    if check_id and "id" in data:
        return "id must not be supplied in request body"

    for field in ("title", "author", "isbn"):
        if field not in data:
            return f"Missing required field: {field}"
        if not isinstance(data[field], str):
            return f"Field '{field}' must be a string"
        if not data[field].strip():
            return f"Field '{field}' must not be empty"

    synopsis = data.get("synopsis", "")
    if not isinstance(synopsis, str):
        return "Field 'synopsis' must be a string"

    return None


class BookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress logs

    def _send_json(self, status, data=None):
        body = json.dumps(data).encode("utf-8") if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if body:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query)
        return path, params

    def do_GET(self):
        path, params = self._parse_path()
        if path == "/books":
            self._handle_get_books(params)
        else:
            parts = path.split("/")
            if len(parts) == 3 and parts[1] == "books":
                try:
                    book_id = int(parts[2])
                except ValueError:
                    self._send_json(400, {"error": "id must be an integer"})
                    return
                book = store.get(book_id)
                if book is None:
                    self._send_json(404, {"error": "Book not found"})
                else:
                    self._send_json(200, book)
            else:
                self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path, params = self._parse_path()
        if path == "/books":
            self._handle_create_book(params)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        path, params = self._parse_path()
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "id must be an integer"})
                return
            self._handle_update_book(book_id)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        path, params = self._parse_path()
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "id must be an integer"})
                return
            if store.delete(book_id):
                self._send_no_content()
            else:
                self._send_json(404, {"error": "Book not found"})
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_get_books(self, params):
        results, err = store.list_books(params)
        if err:
            self._send_json(400, {"error": err})
        else:
            self._send_json(200, results)

    def _handle_create_book(self, params):
        try:
            data = self._read_body()
        except (json.JSONDecodeError, Exception):
            self._send_json(400, {"error": "Invalid JSON"})
            return
        if data is None:
            self._send_json(400, {"error": "Invalid JSON"})
            return
        err = validate_book_fields(data, check_id=True)
        if err:
            self._send_json(400, {"error": err})
            return
        book = store.create(**data)
        self._send_json(201, book)

    def _handle_update_book(self, book_id):
        try:
            data = self._read_body()
        except (json.JSONDecodeError, Exception):
            self._send_json(400, {"error": "Invalid JSON"})
            return
        if data is None:
            self._send_json(400, {"error": "Invalid JSON"})
            return
        err = validate_book_fields(data, check_id=True)
        if err:
            self._send_json(400, {"error": err})
            return
        book = store.update(book_id, **data)
        if book is None:
            self._send_json(404, {"error": "Book not found"})
        else:
            self._send_json(200, book)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on http://127.0.0.1:{port}")
    server.serve_forever()
