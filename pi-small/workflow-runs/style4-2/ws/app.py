import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BOOKS = {}
NEXT_ID = 1
LOCK = threading.Lock()


def make_response(handler, status, body=None):
    handler.send_response(status)
    if body is not None:
        data = json.dumps(body).encode()
        handler.send_header("Content-Type", "application/json")
        handler.end_headers()
        handler.wfile.write(data)
    else:
        handler.end_headers()


def parse_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length)
    return json.loads(raw)


class BookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _get_book(self, book_id):
        return BOOKS.get(book_id)

    def _validate_book_body(self, data):
        required = ("title", "author", "isbn")
        for field in required:
            if field not in data:
                return f"missing '{field}'"
            val = data[field]
            if isinstance(val, bool) or not isinstance(val, str):
                return f"'{field}' must be a string"
            if val.strip() == "":
                return f"'{field}' must not be empty"
        if "id" in data:
            return "'id' must not be supplied in the request body"
        if "synopsis" in data:
            synopsis = data["synopsis"]
            if isinstance(synopsis, bool) or not isinstance(synopsis, str):
                return "'synopsis' must be a string"
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books":
            self.handle_list_books(qs)
        elif path.startswith("/books/"):
            id_part = path[len("/books/"):]
            try:
                book_id = int(id_part)
            except ValueError:
                make_response(self, 400, {"error": "id must be an integer"})
                return
            book = self._get_book(book_id)
            if book is None:
                make_response(self, 404, {"error": "book not found"})
            else:
                make_response(self, 200, book)
        else:
            make_response(self, 404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/books":
            try:
                data = parse_body(self)
            except Exception:
                make_response(self, 400, {"error": "invalid JSON"})
                return
            if not isinstance(data, dict):
                make_response(self, 400, {"error": "body must be a JSON object"})
                return
            err = self._validate_book_body(data)
            if err:
                make_response(self, 400, {"error": err})
                return
            global NEXT_ID
            with LOCK:
                book_id = NEXT_ID
                NEXT_ID += 1
            synopsis = data.get("synopsis", "")
            book = {
                "id": book_id,
                "title": data["title"],
                "author": data["author"],
                "isbn": data["isbn"],
                "synopsis": synopsis,
            }
            with LOCK:
                BOOKS[book_id] = book
            make_response(self, 201, book)
        else:
            make_response(self, 404, {"error": "not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            id_part = path[len("/books/"):]
            try:
                book_id = int(id_part)
            except ValueError:
                make_response(self, 400, {"error": "id must be an integer"})
                return
            try:
                data = parse_body(self)
            except Exception:
                make_response(self, 400, {"error": "invalid JSON"})
                return
            if not isinstance(data, dict):
                make_response(self, 400, {"error": "body must be a JSON object"})
                return
            err = self._validate_book_body(data)
            if err:
                make_response(self, 400, {"error": err})
                return
            with LOCK:
                if book_id not in BOOKS:
                    make_response(self, 404, {"error": "book not found"})
                    return
                synopsis = data.get("synopsis", "")
                BOOKS[book_id] = {
                    "id": book_id,
                    "title": data["title"],
                    "author": data["author"],
                    "isbn": data["isbn"],
                    "synopsis": synopsis,
                }
                book = BOOKS[book_id]
            make_response(self, 200, book)
        else:
            make_response(self, 404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path.startswith("/books/"):
            id_part = path[len("/books/"):]
            try:
                book_id = int(id_part)
            except ValueError:
                make_response(self, 400, {"error": "id must be an integer"})
                return
            with LOCK:
                if book_id not in BOOKS:
                    make_response(self, 404, {"error": "book not found"})
                    return
                del BOOKS[book_id]
            make_response(self, 204)
        else:
            make_response(self, 404, {"error": "not found"})

    def handle_list_books(self, qs):
        valid_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown = set(qs.keys()) - valid_params
        if unknown:
            make_response(
                self, 400, {"error": f"unknown query parameter: {sorted(unknown)[0]}"}
            )
            return

        results = list(BOOKS.values())

        if "id" in qs:
            try:
                target_id = int(qs["id"][0])
            except ValueError:
                make_response(self, 400, {"error": "id query parameter must be an integer"})
                return
            results = [b for b in results if b["id"] == target_id]

        search_fields = ["title", "author", "isbn", "synopsis"]
        q_value = None
        if "q" in qs:
            q_value = qs["q"][0].lower()

        for field in search_fields:
            if field in qs:
                val = qs[field][0].lower()
                results = [b for b in results if val in b[field].lower()]

        if q_value is not None:
            results = [
                b
                for b in results
                if any(q_value in b[f].lower() for f in search_fields)
            ]

        results.sort(key=lambda b: b["id"])
        make_response(self, 200, results)


def main():
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
