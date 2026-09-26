import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self.books = {}
        self.next_id = 1

    def create(self, title, author, isbn, synopsis=""):
        bid = self.next_id
        self.next_id += 1
        book = {"id": bid, "title": title, "author": author, "isbn": isbn, "synopsis": synopsis}
        self.books[bid] = book
        return book

    def get(self, bid):
        return self.books.get(bid)

    def update(self, bid, title, author, isbn, synopsis=""):
        if bid not in self.books:
            return None
        book = {"id": bid, "title": title, "author": author, "isbn": isbn, "synopsis": synopsis}
        self.books[bid] = book
        return book

    def delete(self, bid):
        if bid not in self.books:
            return False
        del self.books[bid]
        return True

    def list_all(self):
        return sorted(self.books.values(), key=lambda b: b["id"])

    def filter_books(self, params):
        books = self.list_all()
        for key, value in params.items():
            if key == "id":
                try:
                    target_id = int(value)
                except ValueError:
                    return None, "Invalid id parameter"
                books = [b for b in books if b["id"] == target_id]
            elif key in ("title", "author", "isbn", "synopsis"):
                search_val = value.lower()
                books = [b for b in books if search_val in b[key].lower()]
            elif key == "q":
                search_val = value.lower()
                books = [b for b in books if any(search_val in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))]
            else:
                return None, f"Unknown query parameter: {key}"
        return books, None


store = BookStore()


class BookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress logs

    def _send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
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
        return self.rfile.read(length)

    def _parse_json_body(self):
        raw = self._read_body()
        if raw is None:
            return None, "Missing request body"
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None, "Invalid JSON"
        if not isinstance(data, dict):
            return None, "Request body must be a JSON object"
        return data, None

    def _validate_book_fields(self, data):
        required = {"title": str, "author": str, "isbn": str}
        for field, ftype in required.items():
            if field not in data:
                return f"Missing required field: {field}"
            val = data[field]
            if not isinstance(val, ftype):
                return f"Field '{field}' must be a string"
            if val.strip() == "":
                return f"Field '{field}' must not be empty"
        if "id" in data:
            return "id must not be supplied by client"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return "Field 'synopsis' must be a string"
        return None

    def _get_path_parts(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query, keep_blank_values=True)
        # flatten single-value lists
        flat_params = {}
        for k, v in params.items():
            flat_params[k] = v[0] if len(v) == 1 else v
        return path, flat_params

    def _match_book_path(self, path):
        m = re.match(r'^/books/(\d+)$', path)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                return None
        return None

    def do_GET(self):
        path, params = self._get_path_parts()

        if path == "/books":
            books, err = store.filter_books(params)
            if err:
                self._send_json(400, {"error": err})
                return
            self._send_json(200, books)
            return

        bid = self._match_book_path(path)
        if bid is not None:
            book = store.get(bid)
            if book is None:
                self._send_json(404, {"error": "Book not found"})
                return
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        path, params = self._get_path_parts()

        if path == "/books":
            data, err = self._parse_json_body()
            if err:
                self._send_json(400, {"error": err})
                return
            val_err = self._validate_book_fields(data)
            if val_err:
                self._send_json(400, {"error": val_err})
                return
            book = store.create(
                data["title"], data["author"], data["isbn"],
                data.get("synopsis", "")
            )
            self._send_json(201, book)
            return

        self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        path, params = self._get_path_parts()

        bid = self._match_book_path(path)
        if bid is not None:
            data, err = self._parse_json_body()
            if err:
                self._send_json(400, {"error": err})
                return
            val_err = self._validate_book_fields(data)
            if val_err:
                self._send_json(400, {"error": val_err})
                return
            book = store.update(
                bid, data["title"], data["author"], data["isbn"],
                data.get("synopsis", "")
            )
            if book is None:
                self._send_json(404, {"error": "Book not found"})
                return
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        path, params = self._get_path_parts()

        bid = self._match_book_path(path)
        if bid is not None:
            if not store.delete(bid):
                self._send_json(404, {"error": "Book not found"})
                return
            self._send_no_content()
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on http://127.0.0.1:{port}")
    server.serve_forever()
