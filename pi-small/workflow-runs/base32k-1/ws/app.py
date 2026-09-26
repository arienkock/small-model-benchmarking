import http.server
import json
import os
import threading
from urllib.parse import urlparse, parse_qs


class BookStore:
    def __init__(self):
        self.books = {}
        self.next_id = 1
        self.lock = threading.Lock()

    def create(self, title, author, isbn, synopsis=""):
        with self.lock:
            b = {"id": self.next_id, "title": title, "author": author, "isbn": isbn, "synopsis": synopsis}
            self.books[self.next_id] = b
            self.next_id += 1
            return dict(b)

    def get(self, book_id):
        with self.lock:
            b = self.books.get(book_id)
            if b is None:
                return None
            return dict(b)

    def update(self, book_id, title, author, isbn, synopsis=""):
        with self.lock:
            if book_id not in self.books:
                return None
            self.books[book_id] = {"id": book_id, "title": title, "author": author, "isbn": isbn, "synopsis": synopsis}
            return dict(self.books[book_id])

    def delete(self, book_id):
        with self.lock:
            if book_id not in self.books:
                return False
            del self.books[book_id]
            return True

    def list_all(self):
        with self.lock:
            return [dict(b) for b in sorted(self.books.values(), key=lambda x: x["id"])]


store = BookStore()


def error_response(handler, code, message):
    body = json.dumps({"error": message}).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def parse_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length > 0:
        raw = handler.rfile.read(length)
    else:
        raw = b""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def validate_book(data):
    for field in ("title", "author", "isbn"):
        if field not in data:
            return False, f"missing field: {field}"
        val = data[field]
        if not isinstance(val, str) or val.strip() == "":
            return False, f"invalid {field}: must be a non-empty string"
    if "synopsis" in data:
        if not isinstance(data["synopsis"], str):
            return False, "invalid synopsis: must be a string"
    if "id" in data:
        return False, "id must not be supplied by client"
    return True, None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json_response(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books":
            self.handle_list(query)
        elif path.startswith("/books/"):
            parts = path.split("/")
            if len(parts) == 3 and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    error_response(self, 400, "id must be an integer")
                    return
                book = store.get(book_id)
                if book is None:
                    error_response(self, 404, "book not found")
                else:
                    self.send_json_response(200, book)
            else:
                error_response(self, 404, "not found")
        else:
            error_response(self, 404, "not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            data = parse_json_body(self)
            if data is None:
                error_response(self, 400, "invalid JSON")
                return
            valid, msg = validate_book(data)
            if not valid:
                error_response(self, 400, msg)
                return
            book = store.create(
                data["title"], data["author"], data["isbn"],
                data.get("synopsis", "")
            )
            self.send_json_response(201, book)
        else:
            error_response(self, 404, "not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            parts = path.split("/")
            if len(parts) == 3 and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    error_response(self, 400, "id must be an integer")
                    return
                data = parse_json_body(self)
                if data is None:
                    error_response(self, 400, "invalid JSON")
                    return
                valid, msg = validate_book(data)
                if not valid:
                    error_response(self, 400, msg)
                    return
                book = store.update(
                    book_id, data["title"], data["author"], data["isbn"],
                    data.get("synopsis", "")
                )
                if book is None:
                    error_response(self, 404, "book not found")
                else:
                    self.send_json_response(200, book)
            else:
                error_response(self, 404, "not found")
        else:
            error_response(self, 404, "not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            parts = path.split("/")
            if len(parts) == 3 and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    error_response(self, 400, "id must be an integer")
                    return
                if store.delete(book_id):
                    self.send_response(204)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                else:
                    error_response(self, 404, "book not found")
            else:
                error_response(self, 404, "not found")
        else:
            error_response(self, 404, "not found")

    def handle_list(self, query):
        known = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in query:
            if key not in known:
                error_response(self, 400, f"unknown query parameter: {key}")
                return

        books = store.list_all()

        if "id" in query:
            try:
                filt_id = int(query["id"][0])
            except ValueError:
                error_response(self, 400, "id must be an integer")
                return
            books = [b for b in books if b["id"] == filt_id]

        def any_match(field, value):
            vl = value.lower()
            return any(vl in (b.get(field, "") or "").lower() for b in books)

        filtered = []
        for b in books:
            ok = True
            if "title" in query and query["title"][0] is not None:
                ok = ok and (query["title"][0].lower() in (b.get("title", "") or "").lower())
            if "author" in query and query["author"][0] is not None:
                ok = ok and (query["author"][0].lower() in (b.get("author", "") or "").lower())
            if "isbn" in query and query["isbn"][0] is not None:
                ok = ok and (query["isbn"][0].lower() in (b.get("isbn", "") or "").lower())
            if "synopsis" in query and query["synopsis"][0] is not None:
                ok = ok and (query["synopsis"][0].lower() in (b.get("synopsis", "") or "").lower())
            if "q" in query and query["q"][0] is not None:
                q = query["q"][0].lower()
                for field in ("title", "author", "isbn", "synopsis"):
                    if q in (b.get(field, "") or "").lower():
                        break
                else:
                    ok = False
            if ok:
                filtered.append(b)

        self.send_json_response(200, filtered)


def run(port):
    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    print(f"Server running on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    run(port)
