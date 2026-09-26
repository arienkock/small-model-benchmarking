import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self.books = {}
        self.next_id = 1

    def create(self, title, author, isbn, synopsis=""):
        book = {"id": self.next_id, "title": title, "author": author,
                "isbn": isbn, "synopsis": synopsis}
        self.books[self.next_id] = book
        self.next_id += 1
        return book

    def get(self, id):
        return self.books.get(id)

    def update(self, id, title, author, isbn, synopsis=""):
        book = {"id": id, "title": title, "author": author,
                "isbn": isbn, "synopsis": synopsis}
        self.books[id] = book
        return book

    def delete(self, id):
        if id in self.books:
            del self.books[id]
            return True
        return False

    def list_all(self):
        return sorted(self.books.values(), key=lambda b: b["id"])

    def filter(self, params):
        books = self.list_all()
        for param_name, values in params.items():
            if param_name == "q":
                val = values[0].lower()
                books = [b for b in books
                         if val in b["title"].lower() or val in b["author"].lower()
                         or val in b["isbn"].lower() or val in b["synopsis"].lower()]
            elif param_name == "id":
                try:
                    fid = int(values[0])
                except ValueError:
                    return None, 400, f"Invalid value for 'id': {values[0]}"
                books = [b for b in books if b["id"] == fid]
            elif param_name in ("title", "author", "isbn", "synopsis"):
                val = values[0].lower()
                books = [b for b in books if val in b[param_name].lower()]
            else:
                return None, 400, f"Unknown query parameter: {param_name}"
        return books, None, None


store = BookStore()


class Handler(BaseHTTPRequestHandler):

    def _send_json(self, code, body=None):
        self.send_response(code)
        if body is not None:
            raw = json.dumps(body).encode("utf-8")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        else:
            self.send_header("Content-Length", "0")
            self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 0:
            return self.rfile.read(length)
        return None

    def _parse_json(self):
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

    def _validate_book(self, data, is_create=False):
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val == "":
                return f"'{field}' is required and must be a non-empty string"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return "'synopsis' must be a string"
        if is_create and "id" in data:
            return "'id' must not be supplied in the request body"
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        raw_params = parse_qs(parsed.query, keep_blank_values=True)

        # Check for unknown query parameters early (only for /books list)
        allowed_keys = {"q", "id", "title", "author", "isbn", "synopsis"}
        if path == "/books":
            for key in raw_params:
                if key not in allowed_keys:
                    self._send_json(400, {"error": f"Unknown query parameter: {key}"})
                    return

        if path == "/books":
            params = dict(raw_params)
            books, code, msg = store.filter(params)
            if code is not None:
                self._send_json(code, {"error": msg})
                return
            self._send_json(200, books)
            return

        # /books/{id}
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
                return
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path != "/books":
            self._send_json(404, {"error": "Not found"})
            return

        data, err_msg = self._parse_json()
        if data is None:
            self._send_json(400, {"error": err_msg})
            return

        err = self._validate_book(data, is_create=True)
        if err is not None:
            self._send_json(400, {"error": err})
            return

        book = store.create(data["title"], data["author"], data["isbn"],
                            data.get("synopsis", ""))
        self._send_json(201, book)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "id must be an integer"})
                return

            if store.get(book_id) is None:
                self._send_json(404, {"error": "Book not found"})
                return

            data, err_msg = self._parse_json()
            if data is None:
                self._send_json(400, {"error": err_msg})
                return

            err = self._validate_book(data)
            if err is not None:
                self._send_json(400, {"error": err})
                return

            book = store.update(book_id, data["title"], data["author"], data["isbn"],
                                data.get("synopsis", ""))
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "id must be an integer"})
                return

            if not store.delete(book_id):
                self._send_json(404, {"error": "Book not found"})
                return
            self._send_json(204)
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on 127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
