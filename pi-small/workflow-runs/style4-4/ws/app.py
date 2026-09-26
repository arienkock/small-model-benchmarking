import http.server
import json
import threading
from urllib.parse import urlparse, parse_qs

# In-memory store: {id: {"id": int, "title": str, "author": str, "isbn": str, "synopsis": str}}
books = {}
next_id = 1
lock = threading.Lock()


class BookHandler(http.server.BaseHTTPRequestHandler):
    # Silence request logs
    def log_message(self, format, *args):
        pass

    def _send_json(self, code, obj=None):
        body = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _error(self, code, message):
        self._send_json(code, {"error": message})

    # ---------- route helpers ----------
    def _parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)
        return path, query

    def _find_book_by_id(self, id_str):
        """Validate id is int and exists. Returns (book, error_response)."""
        try:
            book_id = int(id_str)
        except (ValueError, TypeError):
            return None, (400, "id must be an integer")
        if str(book_id) != id_str and id_str.lstrip("-") == id_str:
            # Handle leading zeros or similar — actually just check existence
            pass
        if book_id not in books:
            return None, (404, f"book with id {book_id} not found")
        return books[book_id], None

    def _validate_required_fields(self, data):
        """Return error message or None."""
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if val is None or not isinstance(val, str) or val.strip() == "":
                return f"'{field}' is required and must be a non-empty string"
        return None

    def _create_book(self, data):
        err = self._validate_required_fields(data)
        if err:
            return (400, err)
        if "id" in data:
            return (400, "book id must not be supplied by the client")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return (400, "'synopsis' must be a string")

        global next_id
        with lock:
            bid = next_id
            next_id += 1
            book = {
                "id": bid,
                "title": data["title"],
                "author": data["author"],
                "isbn": data["isbn"],
                "synopsis": synopsis if synopsis else "",
            }
            books[bid] = book
        return (201, book)

    def _update_book(self, book_id, data):
        err = self._validate_required_fields(data)
        if err:
            return (400, err)
        if "id" in data and data["id"] != book_id:
            return (400, "book id in body must match path")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return (400, "'synopsis' must be a string")

        with lock:
            books[book_id] = {
                "id": book_id,
                "title": data["title"],
                "author": data["author"],
                "isbn": data["isbn"],
                "synopsis": synopsis if synopsis else "",
            }
            return (200, books[book_id])

    # ---------- HTTP methods ----------
    def do_GET(self):
        path, query = self._parse_path()

        if path == "/books":
            self._handle_get_books(query)
        elif path.startswith("/books/"):
            id_str = path[len("/books/"):]
            book, err = self._find_book_by_id(id_str)
            if err:
                self._error(*err)
            else:
                self._send_json(200, book)
        else:
            self._error(404, "not found")

    def do_POST(self):
        path, _ = self._parse_path()
        if path == "/books":
            data = self._read_json_body()
            if data is None:
                self._error(400, "invalid JSON body")
                return
            code, result = self._create_book(data)
            self._send_json(code, result)
        else:
            self._error(404, "not found")

    def do_PUT(self):
        path, _ = self._parse_path()
        if path.startswith("/books/"):
            id_str = path[len("/books/"):]
            book, err = self._find_book_by_id(id_str)
            if err:
                self._error(*err)
                return
            data = self._read_json_body()
            if data is None:
                self._error(400, "invalid JSON body")
                return
            code, result = self._update_book(book["id"], data)
            self._send_json(code, result)
        else:
            self._error(404, "not found")

    def do_DELETE(self):
        path, _ = self._parse_path()
        if path.startswith("/books/"):
            id_str = path[len("/books/"):]
            book, err = self._find_book_by_id(id_str)
            if err:
                self._error(*err)
                return
            with lock:
                del books[book["id"]]
            self._send_no_content()
        else:
            self._error(404, "not found")

    # ---------- GET /books filtering ----------
    def _handle_get_books(self, query):
        valid_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in query:
            if key not in valid_params:
                self._error(400, f"unknown query parameter: {key}")
                return

        with lock:
            result = list(books.values())

        # Filter by id
        if "id" in query:
            try:
                target_id = int(query["id"][0])
            except (ValueError, IndexError):
                self._error(400, "id parameter must be an integer")
                return
            result = [b for b in result if b["id"] == target_id]

        # Case-insensitive contains filtering
        for field in ("title", "author", "isbn", "synopsis"):
            if field in query:
                val = query[field][0].lower()
                result = [b for b in result if val in (b.get(field, "").lower())]

        # Global search
        if "q" in query:
            val = query["q"][0].lower()
            fields = ("title", "author", "isbn", "synopsis")
            result = [b for b in result if any(val in str(b.get(f, "")).lower() for f in fields)]

        # Sort by id
        result.sort(key=lambda b: b["id"])
        self._send_json(200, result)


def run_server():
    port = int(os.environ.get("PORT", 8000))
    server = http.server.HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Serving on 127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    import os
    run_server()
