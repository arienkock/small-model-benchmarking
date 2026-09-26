import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self.books = {}  # id -> book dict
        self.next_id = 1

    def create(self, data):
        title = data.get("title")
        author = data.get("author")
        isbn = data.get("isbn")
        synopsis = data.get("synopsis", "")

        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or not val:
                return None, f"invalid {field}"

        book = {
            "id": self.next_id,
            "title": title,
            "author": author,
            "isbn": isbn,
            "synopsis": synopsis,
        }
        self.books[self.next_id] = book
        self.next_id += 1
        return book, None

    def get(self, bid):
        if not isinstance(bid, int) or bid not in self.books:
            return None
        return self.books[bid]

    def update(self, bid, data):
        title = data.get("title")
        author = data.get("author")
        isbn = data.get("isbn")
        synopsis = data.get("synopsis", "")

        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or not val:
                return None, f"invalid {field}"

        book = self.books.get(bid)
        if book is None:
            return None
        book["title"] = title
        book["author"] = author
        book["isbn"] = isbn
        book["synopsis"] = synopsis
        return book, None

    def delete(self, bid):
        self.books.pop(bid, None)

    def list_all(self, params):
        valid_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in params:
            if key not in valid_params:
                return None, f"unknown query parameter '{key}'"

        results = list(self.books.values())
        results.sort(key=lambda b: b["id"])

        # Apply filters
        if "id" in params and params["id"]:
            target_id_str = params["id"][0]
            try:
                target_id = int(target_id_str)
            except ValueError:
                return None, f"invalid id query parameter"
            results = [b for b in results if b["id"] == target_id]

        lower_map = {}
        for book in results:
            lower_map[book["id"]] = {
                "title": book["title"].lower(),
                "author": book["author"].lower(),
                "isbn": book["isbn"].lower(),
                "synopsis": book["synopsis"].lower(),
            }

        for field in ("title", "author", "isbn", "synopsis"):
            if field in params and params[field]:
                val = params[field][0].lower()
                results = [b for b in results if val in lower_map[b["id"]][field]]

        if "q" in params and params["q"]:
            qval = params["q"][0].lower()
            results = [
                b for b in results
                if any(qval in lower_map[b["id"]][k] for k in ("title", "author", "isbn", "synopsis"))
            ]

        return results, None


store = BookStore()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, code, obj=None):
        body = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
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

    def check_book_id_in_body(self, data):
        if "id" in data:
            return "id is not allowed in the body"
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books":
            self.handle_list(qs)
            return

        m = re.match(r"^/books/(.+)$", path)
        if m:
            self.handle_get_one(m.group(1), qs)
            return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            data = self.read_body()
            if data == "invalid_json":
                self.send_json(400, {"error": "invalid JSON"})
                return
            if data == "not_object":
                self.send_json(400, {"error": "request body must be a JSON object"})
                return
            if data is None:
                self.send_json(400, {"error": "invalid JSON"})
                return

            err = self.check_book_id_in_body(data)
            if err:
                self.send_json(400, {"error": err})
                return

            book, error = store.create(data)
            if error:
                self.send_json(400, {"error": error})
                return
            self.send_json(201, book)
            return

        self.send_json(404, {"error": "not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        m = re.match(r"^/books/(.+)$", path)
        if not m:
            self.send_json(404, {"error": "not found"})
            return

        book_id_str = m.group(1)
        try:
            book_id = int(book_id_str)
        except ValueError:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        if book_id <= 0:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        data = self.read_body()
        if data == "invalid_json":
            self.send_json(400, {"error": "invalid JSON"})
            return
        if data == "not_object":
            self.send_json(400, {"error": "request body must be a JSON object"})
            return
        if data is None:
            self.send_json(400, {"error": "invalid JSON"})
            return

        err = self.check_book_id_in_body(data)
        if err:
            self.send_json(400, {"error": err})
            return

        result, error = store.update(book_id, data)
        if error:
            self.send_json(400, {"error": error})
            return
        if result is None:
            self.send_json(404, {"error": "book not found"})
            return
        self.send_json(200, result)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        m = re.match(r"^/books/(.+)$", path)
        if not m:
            self.send_json(404, {"error": "not found"})
            return

        book_id_str = m.group(1)
        try:
            book_id = int(book_id_str)
        except ValueError:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        if book_id <= 0:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        book = store.get(book_id)
        if book is None:
            self.send_json(404, {"error": "book not found"})
            return

        store.delete(book_id)
        self.send_response(204)
        self.end_headers()

    def handle_list(self, qs):
        results, error = store.list_all(qs)
        if error:
            self.send_json(400, {"error": error})
            return
        self.send_json(200, results)

    def handle_get_one(self, book_id_str, qs):
        try:
            book_id = int(book_id_str)
        except ValueError:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        if book_id <= 0:
            self.send_json(400, {"error": f"invalid id '{book_id_str}'"})
            return

        # Validate no extra query params
        valid_qs = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in qs:
            if key not in valid_qs:
                self.send_json(400, {"error": f"unknown query parameter '{key}'"})
                return

        book = store.get(book_id)
        if book is None:
            self.send_json(404, {"error": "book not found"})
            return
        self.send_json(200, book)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://127.0.0.1:{port}")
    server.serve_forever()
