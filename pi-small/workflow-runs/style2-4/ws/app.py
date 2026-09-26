import http.server
import json
import threading
from urllib.parse import urlparse, parse_qs

BOOKS = {}
NEXT_ID = 1
lock = threading.Lock()


class BookHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress logs

    def _send_json(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _error(self, code, msg):
        self._send_json(code, {"error": msg})

    def _parse_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") if parsed.path != "/" else parsed.path
        if path == "":
            path = "/"
        return path, parse_qs(parsed.query)

    # ---- routing helpers ----
    def _route_books_collection(self):
        global NEXT_ID, BOOKS
        if self.command == "GET":
            return self._list_books()
        elif self.command == "POST":
            return self._create_book()
        else:
            self._error(404, "")

    def _route_books_item(self, book_id_str):
        if self.command == "GET":
            return self._get_book(book_id_str)
        elif self.command == "PUT":
            return self._update_book(book_id_str)
        elif self.command == "DELETE":
            return self._delete_book(book_id_str)
        else:
            self._error(404, "")

    # ---- list books ----
    def _list_books(self):
        global BOOKS
        path, params = self._parse_path()
        allowed = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown = set(params.keys()) - allowed
        if unknown:
            return self._error(400, f"unknown query parameter: {list(unknown)}")

        with lock:
            results = list(BOOKS.values())

        # filter by id= (exact)
        if "id" in params:
            try:
                target_id = int(params["id"][0])
            except ValueError:
                return self._error(400, "invalid id parameter")
            results = [b for b in results if b["id"] == target_id]

        # filters for each field (case-insensitive contains)
        fields = ["title", "author", "isbn", "synopsis"]
        for f in fields:
            if f in params:
                val = params[f][0].lower()
                results = [b for b in results if val in str(b[f]).lower()]

        # global q filter
        if "q" in params:
            val = params["q"][0].lower()
            results = [b for b in results if any(
                val in str(b[ff]).lower() for ff in fields
            )]

        self._send_json(200, sorted(results, key=lambda b: b["id"]))

    # ---- create book ----
    def _create_book(self):
        global NEXT_ID, BOOKS
        try:
            body = self._read_body()
        except Exception:
            return self._error(400, "invalid JSON")
        if not isinstance(body, dict):
            return self._error(400, "request body must be a JSON object")
        if "id" in body:
            return self._error(400, "id must not be supplied by the client")

        title = body.get("title")
        author = body.get("author")
        isbn = body.get("isbn")
        synopsis = body.get("synopsis", "")

        # Validate types
        for field in ("title", "author", "isbn"):
            val = body.get(field)
            if val is None or not isinstance(val, str):
                return self._error(400, f"{field} must be a non-empty string")
            if val.strip() == "":
                return self._error(400, f"{field} must be a non-empty string")

        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")

        with lock:
            book_id = NEXT_ID
            NEXT_ID += 1
            book = {
                "id": book_id,
                "title": title.strip() if isinstance(title, str) else title,
                "author": author.strip() if isinstance(author, str) else author,
                "isbn": isbn.strip() if isinstance(isbn, str) else isbn,
                "synopsis": synopsis,
            }
            BOOKS[book_id] = book

        self._send_json(201, book)

    # ---- get single book ----
    def _get_book(self, book_id_str):
        global BOOKS
        try:
            book_id = int(book_id_str)
        except ValueError:
            return self._error(400, "id must be an integer")
        with lock:
            book = BOOKS.get(book_id)
        if not book:
            return self._error(404, "book not found")
        self._send_json(200, book)

    # ---- update book ----
    def _update_book(self, book_id_str):
        global BOOKS
        try:
            book_id = int(book_id_str)
        except ValueError:
            return self._error(400, "id must be an integer")
        try:
            body = self._read_body()
        except Exception:
            return self._error(400, "invalid JSON")
        if not isinstance(body, dict):
            return self._error(400, "request body must be a JSON object")
        if "id" in body:
            return self._error(400, "id must not be supplied by the client")

        title = body.get("title")
        author = body.get("author")
        isbn = body.get("isbn")
        synopsis = body.get("synopsis", "")

        for field in ("title", "author", "isbn"):
            val = body.get(field)
            if val is None or not isinstance(val, str):
                return self._error(400, f"{field} must be a non-empty string")
            if val.strip() == "":
                return self._error(400, f"{field} must be a non-empty string")

        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")

        with lock:
            if book_id not in BOOKS:
                return self._error(404, "book not found")
            BOOKS[book_id] = {
                "id": book_id,
                "title": title.strip(),
                "author": author.strip(),
                "isbn": isbn.strip(),
                "synopsis": synopsis,
            }
            updated = BOOKS[book_id]

        self._send_json(200, updated)

    # ---- delete book ----
    def _delete_book(self, book_id_str):
        global BOOKS
        try:
            book_id = int(book_id_str)
        except ValueError:
            return self._error(400, "id must be an integer")
        with lock:
            if book_id not in BOOKS:
                return self._error(404, "book not found")
            del BOOKS[book_id]

        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- main dispatch ----
    def do_GET(self):
        path, _ = self._parse_path()
        if path == "/books":
            return self._route_books_collection()
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            return self._route_books_item(parts[2])
        self._error(404, "not found")

    def do_POST(self):
        path, _ = self._parse_path()
        if path == "/books":
            return self._route_books_collection()
        self._error(404, "not found")

    def do_PUT(self):
        path, _ = self._parse_path()
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            return self._route_books_item(parts[2])
        self._error(404, "not found")

    def do_DELETE(self):
        path, _ = self._parse_path()
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            return self._route_books_item(parts[2])
        self._error(404, "not found")


def run_server():
    port = int(os.environ.get("PORT", 8000))
    server = http.server.HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Listening on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    import os
    run_server()
