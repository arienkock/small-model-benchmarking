import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


books = {}
next_id = [1]


class BookHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
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

    def _send_error(self, code, message):
        self._send_json(code, {"error": message})

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _parse_body(self):
        raw = self._read_body()
        if not raw:
            return None, "Request body is empty"
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None, "Invalid JSON"
        if not isinstance(data, dict):
            return None, "Request body is not a JSON object"
        return data, None

    def _validate_book(self, data):
        for field in ("title", "author", "isbn"):
            if field not in data:
                return f"Missing required field: {field}"
            val = data[field]
            if not isinstance(val, str) or val.strip() == "":
                return f"Field '{field}' must be a non-empty string"
        if "synopsis" in data:
            if not isinstance(data["synopsis"], str):
                return "Field 'synopsis' must be a string"
        if "id" in data:
            return "'id' must not be provided by the client"
        return None

    def _build_book(self, book_id, data):
        synopsis = data.get("synopsis", "")
        return {
            "id": book_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }

    def _route(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path != "/" and path.endswith("/"):
            path = path.rstrip("/")
        qs = parse_qs(parsed.query, keep_blank_values=True)
        return path, qs

    def do_GET(self):
        path, qs = self._route()

        if path == "/books":
            allowed = {"id", "title", "author", "isbn", "synopsis", "q"}
            for key in qs:
                if key not in allowed:
                    return self._send_error(400, f"Unknown query parameter: {key}")

            result = sorted(books.values(), key=lambda b: b["id"])

            if "id" in qs:
                val = qs["id"][0]
                try:
                    target_id = int(val)
                except ValueError:
                    return self._send_error(400, "'id' query parameter must be an integer")
                result = [b for b in result if b["id"] == target_id]

            if "q" in qs:
                term = qs["q"][0].lower()
                result = [b for b in result
                          if term in b["title"].lower()
                          or term in b["author"].lower()
                          or term in b["isbn"].lower()
                          or term in b["synopsis"].lower()]

            for field in ("title", "author", "isbn", "synopsis"):
                if field in qs:
                    term = qs[field][0].lower()
                    result = [b for b in result if term in b[field].lower()]

            return self._send_json(200, result)

        m = re.fullmatch(r"/books/(\d+)", path)
        if m:
            book_id = int(m.group(1))
            if book_id not in books:
                return self._send_error(404, f"Book with id {book_id} not found")
            return self._send_json(200, books[book_id])

        self._send_error(404, "Not found")

    def do_POST(self):
        path, qs = self._route()

        if path == "/books":
            data, err = self._parse_body()
            if err:
                return self._send_error(400, err)
            err = self._validate_book(data)
            if err:
                return self._send_error(400, err)
            book_id = next_id[0]
            next_id[0] += 1
            book = self._build_book(book_id, data)
            books[book_id] = book
            return self._send_json(201, book)

        self._send_error(404, "Not found")

    def do_PUT(self):
        path, qs = self._route()

        m = re.fullmatch(r"/books/(\d+)", path)
        if m:
            book_id = int(m.group(1))
            if book_id not in books:
                return self._send_error(404, f"Book with id {book_id} not found")
            data, err = self._parse_body()
            if err:
                return self._send_error(400, err)
            err = self._validate_book(data)
            if err:
                return self._send_error(400, err)
            updated = self._build_book(book_id, data)
            books[book_id] = updated
            return self._send_json(200, updated)

        self._send_error(404, "Not found")

    def do_DELETE(self):
        path, qs = self._route()

        m = re.fullmatch(r"/books/(\d+)", path)
        if m:
            book_id = int(m.group(1))
            if book_id not in books:
                return self._send_error(404, f"Book with id {book_id} not found")
            del books[book_id]
            self.send_response(204)
            self.end_headers()
            return

        self._send_error(404, "Not found")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Serving on http://127.0.0.1:{port}")
    server.serve_forever()
