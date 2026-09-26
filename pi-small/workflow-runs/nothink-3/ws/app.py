import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if body:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query, keep_blank_values=True)
        # Flatten single-value lists
        flat = {}
        for k, v in query.items():
            flat[k] = v[0] if len(v) == 1 else v
        return path, flat

    def _validate_book_fields(self, data):
        """Validate and extract book fields. Returns (title, author, isbn, synopsis) or raises ValueError."""
        for field in ("title", "author", "isbn"):
            if field not in data:
                raise ValueError(f"Missing required field: {field}")
            val = data[field]
            if not isinstance(val, str):
                raise ValueError(f"Field '{field}' must be a string")
            if val.strip() == "":
                raise ValueError(f"Field '{field}' must not be empty")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            raise ValueError("Field 'synopsis' must be a string")
        return data["title"], data["author"], data["isbn"], synopsis

    def _handle_books_collection(self, query):
        result = list(books.values())
        # Check for unknown query params
        allowed_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in query:
            if key not in allowed_params:
                self._send_json(400, {"error": f"Unknown query parameter: {key}"})
                return

        # Filter by id if present
        if "id" in query:
            try:
                fid = int(query["id"])
            except ValueError:
                self._send_json(400, {"error": "Invalid id parameter"})
                return
            result = [b for b in result if b["id"] == fid]

        # Filter by other fields (contains, case-insensitive)
        for field in ("title", "author", "isbn", "synopsis"):
            if field in query:
                val = query[field].lower()
                result = [b for b in result if val in b[field].lower()]

        # Global search q
        if "q" in query:
            val = query["q"].lower()
            result = [b for b in result if any(val in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))]

        result.sort(key=lambda b: b["id"])
        self._send_json(200, result)

    def _handle_book_item(self, book_id_str):
        try:
            book_id = int(book_id_str)
        except ValueError:
            self._send_json(400, {"error": "Invalid id"})
            return
        if book_id not in books:
            self._send_json(404, {"error": "Book not found"})
            return
        self._send_json(200, books[book_id])

    def do_GET(self):
        path, query = self._parse_path()
        if path == "/books":
            self._handle_books_collection(query)
        elif path.startswith("/books/"):
            book_id_str = path[len("/books/"):]
            self._handle_book_item(book_id_str)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        global next_id
        path, query = self._parse_path()
        if path == "/books":
            data = self._read_body()
            if data is None:
                self._send_json(400, {"error": "Invalid JSON"})
                return
            if "id" in data:
                self._send_json(400, {"error": "id must not be supplied by client"})
                return
            try:
                title, author, isbn, synopsis = self._validate_book_fields(data)
            except ValueError as e:
                self._send_json(400, {"error": str(e)})
                return
            book_id = next_id
            next_id += 1
            book = {
                "id": book_id,
                "title": title,
                "author": author,
                "isbn": isbn,
                "synopsis": synopsis,
            }
            books[book_id] = book
            self._send_json(201, book)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        path, query = self._parse_path()
        if path.startswith("/books/"):
            book_id_str = path[len("/books/"):]
            try:
                book_id = int(book_id_str)
            except ValueError:
                self._send_json(400, {"error": "Invalid id"})
                return
            if book_id not in books:
                self._send_json(404, {"error": "Book not found"})
                return
            data = self._read_body()
            if data is None:
                self._send_json(400, {"error": "Invalid JSON"})
                return
            if "id" in data:
                self._send_json(400, {"error": "id must not be supplied by client"})
                return
            try:
                title, author, isbn, synopsis = self._validate_book_fields(data)
            except ValueError as e:
                self._send_json(400, {"error": str(e)})
                return
            books[book_id] = {
                "id": book_id,
                "title": title,
                "author": author,
                "isbn": isbn,
                "synopsis": synopsis,
            }
            self._send_json(200, books[book_id])
        else:
            self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        path, query = self._parse_path()
        if path.startswith("/books/"):
            book_id_str = path[len("/books/"):]
            try:
                book_id = int(book_id_str)
            except ValueError:
                self._send_json(400, {"error": "Invalid id"})
                return
            if book_id not in books:
                self._send_json(404, {"error": "Book not found"})
                return
            del books[book_id]
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send_json(404, {"error": "Not found"})


def main():
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()
