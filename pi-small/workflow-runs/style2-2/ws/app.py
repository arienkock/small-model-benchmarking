import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# In-memory store
books = {}  # id -> book dict
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json(status, {"error": message})

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return "INVALID_JSON"
        if not isinstance(data, dict):
            return "NOT_OBJECT"
        return data

    def _get_id_from_path(self, path):
        """Extract id from /books/{id}. Returns (book_id_int, error_message_or_None)."""
        parts = path.strip("/").split("/")
        if len(parts) != 2:
            return None, "BAD_PATH"
        try:
            book_id = int(parts[1])
        except ValueError:
            return None, "ID_NOT_INTEGER"
        return book_id, None

    def _validate_book_fields(self, data):
        """Validate required fields. Returns (cleaned_dict, error_message)."""
        for field in ("title", "author", "isbn"):
            if field not in data or not isinstance(data[field], str) or data[field].strip() == "":
                return None, f"Missing or empty '{field}'"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return None, "'synopsis' must be a string"
        return {
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }, None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query, keep_blank_values=True)

        # GET /books/{id}
        if path.startswith("/books/"):
            book_id, err = self._get_id_from_path(path)
            if err == "ID_NOT_INTEGER":
                return self._send_error(400, "Book ID must be an integer")
            if err:
                return self._send_error(404, "Not found")
            book = books.get(book_id)
            if book is None:
                return self._send_error(404, "Book not found")
            return self._send_json(200, book)

        # GET /books
        if path == "/books":
            result = list(books.values())

            for key, values in query.items():
                if key in ("id", "title", "author", "isbn", "synopsis", "q"):
                    continue
                return self._send_error(400, f"Unknown query parameter: {key}")

            for v in query.get("id", []):
                try:
                    fid = int(v)
                except ValueError:
                    return self._send_error(400, "Query 'id' must be an integer")
                result = [b for b in result if b["id"] == fid]

            for param in ("title", "author", "isbn", "synopsis"):
                vals = query.get(param, [])
                if vals:
                    val_lower = vals[0].lower()
                    result = [b for b in result if val_lower in b[param].lower()]

            q_vals = query.get("q", [])
            if q_vals:
                q_lower = q_vals[0].lower()
                result = [b for b in result if any(
                    q_lower in b[f].lower() for f in ("title", "author", "isbn", "synopsis")
                )]

            result.sort(key=lambda b: b["id"])
            return self._send_json(200, result)

        # Unknown path
        return self._send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path != "/books":
            return self._send_error(404, "Not found")

        data = self._read_body()
        if data == "INVALID_JSON" or data == "NOT_OBJECT":
            if data == "INVALID_JSON":
                return self._send_error(400, "Body is not valid JSON")
            return self._send_error(400, "Body must be a JSON object")

        if "id" in data:
            return self._send_error(400, "Cannot supply 'id' on create")

        book, err = self._validate_book_fields(data)
        if err:
            return self._send_error(400, err)

        global next_id
        book["id"] = next_id
        books[next_id] = book
        next_id += 1
        return self._send_json(201, book)

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if not path.startswith("/books/"):
            return self._send_error(404, "Not found")

        book_id, err = self._get_id_from_path(path)
        if err == "ID_NOT_INTEGER":
            return self._send_error(400, "Book ID must be an integer")
        if err:
            return self._send_error(404, "Not found")

        book = books.get(book_id)
        if book is None:
            return self._send_error(404, "Book not found")

        data = self._read_body()
        if data == "INVALID_JSON" or data == "NOT_OBJECT":
            if data == "INVALID_JSON":
                return self._send_error(400, "Body is not valid JSON")
            return self._send_error(400, "Body must be a JSON object")

        # Update: title, author, isbn are required; synopsis defaults to ""
        for field in ("title", "author", "isbn"):
            if field not in data or not isinstance(data[field], str) or data[field].strip() == "":
                return self._send_error(400, f"Missing or empty '{field}'")

        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return self._send_error(400, "'synopsis' must be a string")

        book["title"] = data["title"]
        book["author"] = data["author"]
        book["isbn"] = data["isbn"]
        book["synopsis"] = synopsis
        return self._send_json(200, book)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if not path.startswith("/books/"):
            return self._send_error(404, "Not found")

        book_id, err = self._get_id_from_path(path)
        if err == "ID_NOT_INTEGER":
            return self._send_error(400, "Book ID must be an integer")
        if err:
            return self._send_error(404, "Not found")

        book = books.get(book_id)
        if book is None:
            return self._send_error(404, "Book not found")

        del books[book_id]
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress logs


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Serving on http://127.0.0.1:{port}")
    server.serve_forever()
