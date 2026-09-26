import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self.books = {}  # id -> dict
        self.next_id = 1

    def create(self, title, author, isbn, synopsis=""):
        book = {
            "id": self.next_id,
            "title": title,
            "author": author,
            "isbn": isbn,
            "synopsis": synopsis,
        }
        self.books[self.next_id] = book
        self.next_id += 1
        return book

    def get(self, id):
        return self.books.get(id)

    def update(self, id, title, author, isbn, synopsis=""):
        if id not in self.books:
            return None
        self.books[id] = {
            "id": id,
            "title": title,
            "author": author,
            "isbn": isbn,
            "synopsis": synopsis,
        }
        return self.books[id]

    def delete(self, id):
        if id in self.books:
            del self.books[id]
            return True
        return False

    def list_all(self):
        return sorted(self.books.values(), key=lambda b: b["id"])


store = BookStore()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code, data=None):
        body = json.dumps(data).encode("utf-8") if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val == "":
                return f"Missing or empty required field: {field}"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return "Field 'synopsis' must be a string"
        return None

    def _handle_create(self):
        data, err = self._parse_json_body()
        if err:
            return 400, err
        if "id" in data:
            return 400, "Do not supply 'id' on create"
        err = self._validate_book_fields(data)
        if err:
            return 400, err
        book = store.create(data["title"], data["author"], data["isbn"], data.get("synopsis", ""))
        return 201, book

    def _handle_get_one(self, id_str):
        try:
            book_id = int(id_str)
        except ValueError:
            return 400, "id must be an integer"
        if str(book_id) != id_str and book_id != 0:
            # Reject leading zeros like "01"
            pass
        book = store.get(book_id)
        if book is None:
            return 404, "Book not found"
        return 200, book

    def _handle_put_one(self, id_str):
        try:
            book_id = int(id_str)
        except ValueError:
            return 400, "id must be an integer"
        data, err = self._parse_json_body()
        if err:
            return 400, err
        err = self._validate_book_fields(data)
        if err:
            return 400, err
        book = store.update(book_id, data["title"], data["author"], data["isbn"], data.get("synopsis", ""))
        if book is None:
            return 404, "Book not found"
        return 200, book

    def _handle_delete_one(self, id_str):
        try:
            book_id = int(id_str)
        except ValueError:
            return 400, "id must be an integer"
        if store.delete(book_id):
            return 204, None
        return 404, "Book not found"

    def _handle_list(self, qs):
        params = parse_qs(qs, keep_blank_values=True)
        known_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in params:
            if key not in known_params:
                return 400, f"Unknown query parameter: {key}"

        books = store.list_all()

        id_param = params.get("id")
        if id_param:
            try:
                target_id = int(id_param[0])
            except ValueError:
                return 400, "id filter must be an integer"
            books = [b for b in books if b["id"] == target_id]

        filters = ("title", "author", "isbn", "synopsis")
        for f in filters:
            vals = params.get(f)
            if vals:
                query = vals[0].lower()
                books = [b for b in books if query in b[f].lower()]

        q_vals = params.get("q")
        if q_vals:
            query = q_vals[0].lower()
            books = [
                b for b in books
                if any(query in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))
            ]

        return 200, books

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parsed.query

        if path == "/books" and self.command == "GET":
            code, data = self._handle_list(qs)
            return code, data
        elif path == "/books" and self.command == "POST":
            code, data = self._handle_create()
            return code, data
        elif path == "/books" and self.command in ("PUT", "DELETE"):
            return 405, "Method not allowed on /books collection"

        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            id_str = parts[2]
            if self.command == "GET":
                code, data = self._handle_get_one(id_str)
                return code, data
            elif self.command == "PUT":
                code, data = self._handle_put_one(id_str)
                return code, data
            elif self.command == "DELETE":
                code, data = self._handle_delete_one(id_str)
                return code, data

        return 404, {"error": "Not found"}

    def _dispatch(self):
        code, data = self._route()
        if code == 204:
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif isinstance(data, dict) and "error" in data or (isinstance(data, str)):
            msg = {"error": data} if isinstance(data, str) else data
            self._send_json(code, msg)
        else:
            self._send_json(code, data)

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def log_message(self, format, *args):
        pass  # suppress logging


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Listening on 127.0.0.1:{port}")
    server.serve_forever()
