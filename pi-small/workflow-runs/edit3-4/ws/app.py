import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}
next_id = 1
lock = threading.Lock()


class BookHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if data is not None:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json(status, {"error": message})

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        return raw

    def _parse_json_body(self):
        raw = self._read_body()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _validate_book_fields(self, data):
        required = ["title", "author", "isbn"]
        for field in required:
            if field not in data:
                return f"Missing required field: {field}"
            val = data[field]
            if not isinstance(val, str) or val.strip() == "":
                return f"Field '{field}' must be a non-empty string"
        synopsis = data.get("synopsis", "")
        if "synopsis" in data:
            if not isinstance(synopsis, str):
                return "Field 'synopsis' must be a string"
        if "id" in data:
            return "Do not supply 'id' in request body"
        return None

    def _find_book_by_path(self, path):
        parts = path.strip("/").split("/")
        if len(parts) == 1 and parts[0] == "books":
            return None, True
        if len(parts) == 2 and parts[0] == "books":
            try:
                book_id = int(parts[1])
            except ValueError:
                return None, False
            return book_id, True
        return None, False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books":
            self._handle_get_books(params)
        else:
            book_id, valid_path = self._find_book_by_path(path)
            if not valid_path:
                self._send_error(404, "Not found")
                return
            with lock:
                if book_id not in books:
                    self._send_error(404, "Book not found")
                    return
                self._send_json(200, dict(books[book_id]))

    def _handle_get_books(self, params):
        known_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in params:
            if key not in known_params:
                self._send_error(400, f"Unknown query parameter: {key}")
                return

        with lock:
            result = sorted(books.values(), key=lambda b: b["id"])

        if "id" in params:
            try:
                target_id = int(params["id"][0])
            except ValueError:
                self._send_error(400, "Invalid id parameter")
                return
            result = [b for b in result if b["id"] == target_id]

        # Build per-field filters and q filter
        field_filters = {}
        q_filter = None
        for key in params:
            if key == "id":
                continue
            val = params[key][0].lower()
            if key == "q":
                q_filter = val
            else:
                field_filters[key] = val

        # Apply per-field filters
        for field, value in field_filters.items():
            result = [b for b in result if value in str(b.get(field, "")).lower()]

        # Apply q filter: matches any of title, author, isbn, synopsis
        if q_filter is not None:
            search_fields = ["title", "author", "isbn", "synopsis"]
            result = [
                b for b in result
                if any(q_filter in str(b.get(f, "")).lower() for f in search_fields)
            ]

        self._send_json(200, [dict(b) for b in result])

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            data = self._parse_json_body()
            if data is None:
                self._send_error(400, "Invalid JSON body")
                return
            error = self._validate_book_fields(data)
            if error:
                self._send_error(400, error)
                return

            global next_id
            with lock:
                book_id = next_id
                next_id += 1
                book = {
                    "id": book_id,
                    "title": data["title"],
                    "author": data["author"],
                    "isbn": data["isbn"],
                    "synopsis": data.get("synopsis", ""),
                }
                books[book_id] = dict(book)
            self._send_json(201, book)
        else:
            self._send_error(404, "Not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        book_id, valid_path = self._find_book_by_path(path)
        if not valid_path:
            self._send_error(404, "Not found")
            return

        data = self._parse_json_body()
        if data is None:
            self._send_error(400, "Invalid JSON body")
            return
        error = self._validate_book_fields(data)
        if error:
            self._send_error(400, error)
            return

        with lock:
            if book_id not in books:
                self._send_error(404, "Book not found")
                return
            books[book_id] = {
                "id": book_id,
                "title": data["title"],
                "author": data["author"],
                "isbn": data["isbn"],
                "synopsis": data.get("synopsis", ""),
            }
            self._send_json(200, dict(books[book_id]))

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        book_id, valid_path = self._find_book_by_path(path)
        if not valid_path:
            self._send_error(404, "Not found")
            return

        with lock:
            if book_id not in books:
                self._send_error(404, "Book not found")
                return
            del books[book_id]
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Serving on 127.0.0.1:{port}")
    server.serve_forever()
