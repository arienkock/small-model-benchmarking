import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}  # id -> book dict
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    def _parse_json_body(self):
        raw = self._read_body()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _error(self, code, msg):
        self._send_json(code, {"error": msg})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books":
            return self._handle_list(qs)
        elif path.startswith("/books/"):
            parts = path.split("/")
            # /books/<id> -> ['', 'books', '<id>']
            if len(parts) == 3:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    return self._error(400, "id must be an integer")
                book = books.get(book_id)
                if book is None:
                    return self._error(404, "book not found")
                return self._send_json(200, book)
        self._error(404, "not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/books":
            data = self._parse_json_body()
            if data is None:
                return self._error(400, "invalid JSON body")
            return self._handle_create(data)
        self._error(404, "not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path.startswith("/books/"):
            parts = path.split("/")
            if len(parts) == 3:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    return self._error(400, "id must be an integer")
                data = self._parse_json_body()
                if data is None:
                    return self._error(400, "invalid JSON body")
                return self._handle_update(book_id, data)
        self._error(404, "not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path.startswith("/books/"):
            parts = path.split("/")
            if len(parts) == 3:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    return self._error(400, "id must be an integer")
                if book_id not in books:
                    return self._error(404, "book not found")
                del books[book_id]
                self.send_response(204)
                self.end_headers()
                return
        self._error(404, "not found")

    def _handle_create(self, data):
        global next_id
        # Reject id in body
        if "id" in data:
            return self._error(400, "id must not be supplied in request body")

        required = ("title", "author", "isbn")
        for field in required:
            val = data.get(field)
            if not isinstance(val, str) or not val:
                return self._error(400, f"{field} is required and must be a non-empty string")

        # synopsis is optional
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")

        book_id = next_id
        next_id += 1
        book = {
            "id": book_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }
        books[book_id] = book
        return self._send_json(201, book)

    def _handle_update(self, book_id, data):
        if book_id not in books:
            return self._error(404, "book not found")
        # Reject id in body
        if "id" in data:
            return self._error(400, "id must not be supplied in request body")

        required = ("title", "author", "isbn")
        for field in required:
            val = data.get(field)
            if not isinstance(val, str) or not val:
                return self._error(400, f"{field} is required and must be a non-empty string")

        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")

        book = {
            "id": book_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }
        books[book_id] = book
        return self._send_json(200, book)

    def _handle_list(self, qs):
        allowed_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in qs:
            if key not in allowed_params:
                return self._error(400, f"unknown query parameter: {key}")

        result = list(books.values())

        # Filter by id (exact match)
        if "id" in qs:
            try:
                target_id = int(qs["id"][0])
            except ValueError:
                return self._error(400, "id query parameter must be an integer")
            result = [b for b in result if b["id"] == target_id]

        # Case-insensitive contains filters
        for field in ("title", "author", "isbn", "synopsis"):
            if field in qs:
                val = qs[field][0].lower()
                result = [b for b in result if val in b[field].lower()]

        # Global search
        if "q" in qs:
            val = qs["q"][0].lower()
            result = [b for b in result
                      if val in b["title"].lower() or
                         val in b["author"].lower() or
                         val in b["isbn"].lower() or
                         val in b["synopsis"].lower()]

        result.sort(key=lambda b: b["id"])
        return self._send_json(200, result)

    def log_message(self, format, *args):
        pass  # suppress logs


def main():
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
