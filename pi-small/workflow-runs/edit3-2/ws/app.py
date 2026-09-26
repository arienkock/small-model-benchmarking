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
            self._send_json(400, {"error": "Invalid JSON"})
            return None
        if not isinstance(data, dict):
            self._send_json(400, {"error": "JSON body must be an object"})
            return None
        return data

    def _validate_book(self, data):
        required = [("title", str), ("author", str), ("isbn", str)]
        for field, typ in required:
            if field not in data:
                self._send_json(400, {"error": f"Missing required field: {field}"})
                return None
            val = data[field]
            if not isinstance(val, typ) or not val.strip():
                self._send_json(400, {"error": f"Field '{field}' must be a non-empty string"})
                return None
        if "synopsis" in data:
            if not isinstance(data["synopsis"], str):
                self._send_json(400, {"error": "Field 'synopsis' must be a string"})
                return None
        if "id" in data:
            self._send_json(400, {"error": "Do not supply 'id' field"})
            return None
        synopsis = data.get("synopsis", "")
        book = {
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }
        return book

    def _parse_book_id(self, path):
        parts = path.strip("/").split("/")
        if len(parts) != 2:
            return None
        try:
            return int(parts[1])
        except ValueError:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            self._list_books(parsed.query)
        elif path.startswith("/books/"):
            bid = self._parse_book_id(path)
            if bid is None:
                self._send_json(400, {"error": "Invalid book id"})
                return
            if bid not in books:
                self._send_json(404, {"error": "Book not found"})
                return
            self._send_json(200, books[bid])
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            data = self._parse_json_body()
            if data is None:
                return
            book = self._validate_book(data)
            if book is None:
                return
            global next_id
            bid = next_id
            next_id += 1
            book["id"] = bid
            books[bid] = book
            self._send_json(201, book)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            bid = self._parse_book_id(path)
            if bid is None:
                self._send_json(400, {"error": "Invalid book id"})
                return
            if bid not in books:
                self._send_json(404, {"error": "Book not found"})
                return
            data = self._parse_json_body()
            if data is None:
                return
            book = self._validate_book(data)
            if book is None:
                return
            book["id"] = bid
            books[bid] = book
            self._send_json(200, book)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            bid = self._parse_book_id(path)
            if bid is None:
                self._send_json(400, {"error": "Invalid book id"})
                return
            if bid not in books:
                self._send_json(404, {"error": "Book not found"})
                return
            del books[bid]
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send_json(404, {"error": "Not found"})

    def _list_books(self, query_string):
        params = parse_qs(query_string)

        valid_keys = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in params:
            if key not in valid_keys:
                self._send_json(400, {"error": f"Unknown query parameter: {key}"})
                return

        results = sorted(books.values(), key=lambda b: b["id"])

        if "id" in params:
            try:
                target_id = int(params["id"][0])
            except ValueError:
                self._send_json(400, {"error": "Invalid id parameter"})
                return
            results = [b for b in results if b["id"] == target_id]

        text_fields = ["title", "author", "isbn", "synopsis"]
        for field in text_fields:
            if field in params:
                val = params[field][0].lower()
                results = [b for b in results if val in b[field].lower()]

        if "q" in params:
            qval = params["q"][0].lower()
            results = [b for b in results if any(qval in b[f].lower() for f in text_fields)]

        self._send_json(200, results)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on 127.0.0.1:{port}")
    server.serve_forever()
