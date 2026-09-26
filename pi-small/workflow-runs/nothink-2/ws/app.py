import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# In-memory store: {id: book_dict}
books = {}
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code, message):
        self._send_json(code, {"error": message})

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return "invalid_json"
        if not isinstance(data, dict):
            return "not_object"
        return data

    def _parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query, keep_blank_values=True)
        # Flatten single-value params; reject unknown keys
        allowed_qs = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown_keys = set(qs.keys()) - allowed_qs
        if unknown_keys:
            return None, None, f"unknown query parameter: {', '.join(sorted(unknown_keys))}"
        # Convert single-value lists to scalars
        flat = {}
        for k, v in qs.items():
            flat[k] = v[0] if len(v) == 1 else v
        return path, flat, None

    def _validate_book_fields(self, data):
        """Returns (title, author, isbn, synopsis) or raises ValueError."""
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val.strip() == "":
                raise ValueError(f"'{field}' is required and must be a non-empty string")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            raise ValueError("'synopsis' must be a string")
        return data["title"], data["author"], data["isbn"], synopsis

    def do_GET(self):
        path, qs, err = self._parse_path()
        if err:
            return self._send_error(400, err)

        if path == "/books":
            self._handle_get_books(qs)
        elif path.startswith("/books/"):
            id_str = path[len("/books/"):]
            try:
                bid = int(id_str)
            except ValueError:
                return self._send_error(400, "id must be an integer")
            book = books.get(bid)
            if book is None:
                return self._send_error(404, "book not found")
            self._send_json(200, book)
        else:
            self._send_error(404, "not found")

    def _handle_get_books(self, qs):
        result = list(books.values())
        # Filter by id param (must be integer)
        if "id" in qs:
            try:
                fid = int(qs["id"])
            except ValueError:
                return self._send_error(400, "id query parameter must be an integer")
            result = [b for b in result if b["id"] == fid]

        # Text filters (case-insensitive contains)
        for field in ("title", "author", "isbn", "synopsis"):
            if field in qs:
                val = qs[field].lower()
                result = [b for b in result if val in b[field].lower()]

        # Global search q=
        if "q" in qs:
            val = qs["q"].lower()
            result = [b for b in result if any(val in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))]

        result.sort(key=lambda b: b["id"])
        self._send_json(200, result)

    def do_POST(self):
        path, qs, err = self._parse_path()
        if err:
            return self._send_error(400, err)

        if path == "/books":
            data = self._read_body()
            if data == "invalid_json":
                return self._send_error(400, "invalid JSON body")
            if data == "not_object":
                return self._send_error(400, "body must be a JSON object")
            # Check no 'id' in body
            if "id" in data:
                return self._send_error(400, "'id' must not be supplied by the client")
            try:
                title, author, isbn, synopsis = self._validate_book_fields(data)
            except ValueError as e:
                return self._send_error(400, str(e))
            global next_id
            bid = next_id
            next_id += 1
            book = {"id": bid, "title": title, "author": author, "isbn": isbn, "synopsis": synopsis}
            books[bid] = book
            self._send_json(201, book)
        else:
            self._send_error(404, "not found")

    def do_PUT(self):
        path, qs, err = self._parse_path()
        if err:
            return self._send_error(400, err)

        if path.startswith("/books/"):
            id_str = path[len("/books/"):]
            try:
                bid = int(id_str)
            except ValueError:
                return self._send_error(400, "id must be an integer")
            book = books.get(bid)
            if book is None:
                return self._send_error(404, "book not found")
            data = self._read_body()
            if data == "invalid_json":
                return self._send_error(400, "invalid JSON body")
            if data == "not_object":
                return self._send_error(400, "body must be a JSON object")
            if "id" in data:
                return self._send_error(400, "'id' must not be supplied by the client")
            try:
                title, author, isbn, synopsis = self._validate_book_fields(data)
            except ValueError as e:
                return self._send_error(400, str(e))
            book["title"] = title
            book["author"] = author
            book["isbn"] = isbn
            book["synopsis"] = synopsis
            self._send_json(200, book)
        else:
            self._send_error(404, "not found")

    def do_DELETE(self):
        path, qs, err = self._parse_path()
        if err:
            return self._send_error(400, err)

        if path.startswith("/books/"):
            id_str = path[len("/books/"):]
            try:
                bid = int(id_str)
            except ValueError:
                return self._send_error(400, "id must be an integer")
            book = books.get(bid)
            if book is None:
                return self._send_error(404, "book not found")
            del books[bid]
            self.send_response(204)
            self.end_headers()
        else:
            self._send_error(404, "not found")

    def log_message(self, format, *args):
        pass  # suppress logs


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
