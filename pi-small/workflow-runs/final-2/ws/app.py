import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}
next_id = 1


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code, body=None):
        data = json.dumps(body).encode() if body is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            obj = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return "invalid"
        if not isinstance(obj, dict):
            return "invalid"
        return obj

    def _error(self, code, msg):
        self._send_json(code, {"error": msg})

    def _parse_path(self):
        parsed = urlparse(self.path)
        return parsed.path.rstrip("/") or "/", parse_qs(parsed.query)

    def do_GET(self):
        path, qs = self._parse_path()

        if path == "/books":
            self._handle_list(qs)
        elif path.startswith("/books/"):
            self._handle_get_one(path)
        else:
            self._error(404, "not found")

    def do_POST(self):
        path, qs = self._parse_path()
        if path == "/books":
            self._handle_create(qs)
        else:
            self._error(404, "not found")

    def do_PUT(self):
        path, qs = self._parse_path()
        if path.startswith("/books/"):
            self._handle_update(path)
        else:
            self._error(404, "not found")

    def do_DELETE(self):
        path, qs = self._parse_path()
        if path.startswith("/books/"):
            self._handle_delete(path)
        else:
            self._error(404, "not found")

    def _validate_book_fields(self, data, accept_synopsis=True):
        for field in ("title", "author", "isbn"):
            if field not in data or not isinstance(data[field], str) or data[field] == "":
                return f"missing or empty '{field}'"
        if accept_synopsis:
            if "synopsis" in data and not isinstance(data["synopsis"], str):
                return "'synopsis' must be a string"
        return None

    def _handle_create(self, qs):
        global next_id
        data = self._read_body()
        if data == "invalid":
            return self._error(400, "invalid JSON body")
        if id_val := data.get("id"):
            return self._error(400, "id must not be supplied")

        err = self._validate_book_fields(data)
        if err:
            return self._error(400, err)

        book = {
            "id": next_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": data.get("synopsis", ""),
        }
        books[next_id] = book
        next_id += 1
        self._send_json(201, book)

    def _handle_get_one(self, path):
        parts = path.split("/")
        if len(parts) != 3:
            return self._error(404, "not found")
        try:
            book_id = int(parts[2])
        except ValueError:
            return self._error(400, "invalid id")
        book = books.get(book_id)
        if book is None:
            return self._error(404, "not found")
        self._send_json(200, book)

    def _handle_update(self, path):
        parts = path.split("/")
        if len(parts) != 3:
            return self._error(404, "not found")
        try:
            book_id = int(parts[2])
        except ValueError:
            return self._error(400, "invalid id")
        if book_id not in books:
            return self._error(404, "not found")

        data = self._read_body()
        if data == "invalid":
            return self._error(400, "invalid JSON body")
        if id_val := data.get("id"):
            return self._error(400, "id must not be supplied in update")

        err = self._validate_book_fields(data)
        if err:
            return self._error(400, err)

        books[book_id] = {
            "id": book_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": data.get("synopsis", ""),
        }
        self._send_json(200, books[book_id])

    def _handle_delete(self, path):
        parts = path.split("/")
        if len(parts) != 3:
            return self._error(404, "not found")
        try:
            book_id = int(parts[2])
        except ValueError:
            return self._error(400, "invalid id")
        if book_id not in books:
            return self._error(404, "not found")
        del books[book_id]
        self._send_no_content()

    def _handle_list(self, qs):
        if not qs:
            self._send_json(200, list(books.values()))
            return

        allowed = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in qs:
            if key not in allowed:
                return self._error(400, f"unknown query parameter: {key}")

        results = list(books.values())

        if "id" in qs:
            try:
                target_id = int(qs["id"][0])
            except ValueError:
                return self._error(400, "invalid id parameter")
            results = [b for b in results if b["id"] == target_id]

        filters = ("title", "author", "isbn", "synopsis")
        for field in filters:
            if field in qs:
                val = qs[field][0].lower()
                results = [b for b in results if val in b[field].lower()]

        if "q" in qs:
            qval = qs["q"][0].lower()
            results = [
                b
                for b in results
                if any(qval in b[f].lower() for f in filters)
            ]

        self._send_json(200, sorted(results, key=lambda b: b["id"]))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Listening on 127.0.0.1:{port}")
    server.serve_forever()
