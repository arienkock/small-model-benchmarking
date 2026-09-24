"""HTTP layer for the book store. `python3 app.py` serves on $PORT (default 8000)."""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from store import FIELDS, BookStore, ValidationError

QUERY_KEYS = {"id", "q", *FIELDS}
BOOK_PATH = re.compile(r"/books(?:/([^/]+))?/?")


def make_handler(store):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send_json(self, status, body=None):
            data = b"" if body is None else json.dumps(body).encode()
            self.send_response(status)
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def fail(self, status, message):
            self.send_json(status, {"error": message})

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw.decode("utf-8") or "null")
            except (ValueError, UnicodeDecodeError):
                raise ValidationError("body is not valid JSON")

        def target(self):
            """(matched, id or None, query). id is -1 when the path segment is not an integer."""
            parts = urlsplit(self.path)
            m = BOOK_PATH.fullmatch(parts.path)
            if not m:
                return False, None, parts.query
            if m.group(1) is None:
                return True, None, parts.query
            try:
                return True, int(m.group(1)), parts.query
            except ValueError:
                return True, -1, parts.query

        def do_GET(self):
            matched, book_id, query = self.target()
            if not matched:
                return self.fail(404, "not found")
            if book_id == -1:
                return self.fail(400, "book id must be an integer")
            if book_id is not None:
                book = store.get(book_id)
                return self.send_json(200, book) if book else self.fail(404, f"no book with id {book_id}")
            params = parse_qs(query, keep_blank_values=True)
            unknown = sorted(set(params) - QUERY_KEYS)
            if unknown:
                return self.fail(400, f"unknown query parameter(s): {', '.join(unknown)}")
            filters = {k: v[-1] for k, v in params.items()}
            if "id" in filters:
                try:
                    filters["id"] = int(filters["id"])
                except ValueError:
                    return self.fail(400, "id must be an integer")
            self.send_json(200, store.search(filters))

        def do_POST(self):
            matched, book_id, _ = self.target()
            if not matched or book_id is not None:
                return self.fail(404, "not found")
            try:
                self.send_json(201, store.create(self.body()))
            except ValidationError as e:
                self.fail(400, str(e))

        def do_PUT(self):
            matched, book_id, _ = self.target()
            if not matched or book_id is None:
                return self.fail(404, "not found")
            if book_id == -1:
                return self.fail(400, "book id must be an integer")
            try:
                book = store.update(book_id, self.body())
            except ValidationError as e:
                return self.fail(400, str(e))
            return self.send_json(200, book) if book else self.fail(404, f"no book with id {book_id}")

        def do_DELETE(self):
            matched, book_id, _ = self.target()
            if not matched or book_id is None:
                return self.fail(404, "not found")
            if book_id == -1:
                return self.fail(400, "book id must be an integer")
            if store.delete(book_id):
                return self.send_json(204)
            self.fail(404, f"no book with id {book_id}")

    return Handler


def create_server(port=0, store=None):
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(store or BookStore()))


if __name__ == "__main__":
    server = create_server(int(os.environ.get("PORT", "8000")))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
