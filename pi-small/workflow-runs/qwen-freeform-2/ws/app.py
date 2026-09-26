import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookHandler(BaseHTTPRequestHandler):
    books = {}
    next_id = 1

    def _send_json(self, status_code, data=None):
        body = json.dumps(data).encode("utf-8") if data is not None else b""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_error(self, status_code, message):
        self._send_json(status_code, {"error": message})

    def _read_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return None
        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None

    def _validate_book_fields(self, body):
        errors = []
        for field in ("title", "author", "isbn"):
            if not isinstance(body.get(field), str) or not body[field]:
                errors.append(f"{field.capitalize()} is required")
        if "synopsis" in body:
            if not isinstance(body["synopsis"], str):
                errors.append("Synopsis must be a string")
        return errors

    def _parse_query_params(self, params):
        valid_keys = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown = set(params.keys()) - valid_keys
        if unknown:
            raise ValueError(f"Unknown query parameter: {', '.join(sorted(unknown))}")

    def _filter_books(self, params):
        results = list(BookHandler.books.values())

        if "id" in params:
            try:
                target = int(params["id"][0])
            except (ValueError, IndexError):
                return []
            results = [b for b in results if b["id"] == target]

        if "title" in params:
            val = params["title"][0].lower()
            results = [b for b in results if val in b["title"].lower()]

        if "author" in params:
            val = params["author"][0].lower()
            results = [b for b in results if val in b["author"].lower()]

        if "isbn" in params:
            val = params["isbn"][0].lower()
            results = [b for b in results if val in b["isbn"].lower()]

        if "synopsis" in params:
            val = params["synopsis"][0].lower()
            results = [b for b in results if val in b["synopsis"].lower()]

        if "q" in params:
            val = params["q"][0].lower()
            results = [b for b in results if (
                val in b["title"].lower() or
                val in b["author"].lower() or
                val in b["isbn"].lower() or
                val in b["synopsis"].lower()
            )]

        return sorted(results, key=lambda b: b["id"])

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else "/"
        params = parse_qs(parsed.query, keep_blank_values=True)

        try:
            self._parse_query_params(params)
        except ValueError as e:
            self._send_error(400, str(e))
            return

        if path == "/books":
            books = self._filter_books(params)
            self._send_json(200, books)
        else:
            match = re.match(r"^/books/(\d+)$", path)
            if match:
                book_id = int(match.group(1))
                if book_id in BookHandler.books:
                    self._send_json(200, BookHandler.books[book_id])
                else:
                    self._send_error(404, "Book not found")
            else:
                self._send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else "/"

        if path != "/books":
            self._send_error(404, "Not found")
            return

        body = self._read_body()
        if body is None or not isinstance(body, dict):
            self._send_error(400, "Invalid JSON object")
            return
        if "id" in body:
            self._send_error(400, "Id must not be provided for creation")
            return

        errors = self._validate_book_fields(body)
        if errors:
            self._send_error(400, "; ".join(errors))
            return

        book_id = BookHandler.next_id
        book = {
            "id": book_id,
            "title": body["title"],
            "author": body["author"],
            "isbn": body["isbn"],
            "synopsis": body.get("synopsis", ""),
        }
        BookHandler.books[book_id] = book
        BookHandler.next_id += 1
        self._send_json(201, book)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else "/"

        match = re.match(r"^/books/(\d+)$", path)
        if not match:
            self._send_error(404, "Not found")
            return

        book_id = int(match.group(1))
        if book_id not in BookHandler.books:
            self._send_error(404, "Book not found")
            return

        body = self._read_body()
        if body is None or not isinstance(body, dict):
            self._send_error(400, "Invalid JSON object")
            return

        errors = self._validate_book_fields(body)
        if errors:
            self._send_error(400, "; ".join(errors))
            return

        BookHandler.books[book_id].update({
            "title": body["title"],
            "author": body["author"],
            "isbn": body["isbn"],
            "synopsis": body.get("synopsis", ""),
        })
        self._send_json(200, BookHandler.books[book_id])

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else "/"

        match = re.match(r"^/books/(\d+)$", path)
        if not match:
            self._send_error(404, "Not found")
            return

        book_id = int(match.group(1))
        if book_id not in BookHandler.books:
            self._send_error(404, "Book not found")
            return

        del BookHandler.books[book_id]
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        pass


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
