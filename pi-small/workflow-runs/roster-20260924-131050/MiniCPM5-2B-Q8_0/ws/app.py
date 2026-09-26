import json
import urllib.parse
import threading
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8000"))
HOST = "127.0.0.1"

books = []


class ValidationError(Exception):
    pass


def parse_and_validate_body(body):
    if not isinstance(body, dict):
        raise ValidationError("Invalid JSON")
    # Check required fields first
    if "title" not in body or not body["title"]:
        raise ValidationError("title is required")
    if "author" not in body or not body["author"]:
        raise ValidationError("author is required")
    if "isbn" not in body or not body["isbn"]:
        raise ValidationError("isbn is required")
    # Type checks
    if "title" in body and not isinstance(body["title"], str):
        raise ValidationError("title must be a string")
    if "author" in body and not isinstance(body["author"], str):
        raise ValidationError("author must be a string")
    if "isbn" in body and not isinstance(body["isbn"], str):
        raise ValidationError("isbn must be a string")
    if "synopsis" in body and not isinstance(body["synopsis"], str):
        raise ValidationError("synopsis must be a string")
    return body


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, message):
        body = json.dumps({"error": message}).encode()
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/books":
            self._send_error("not found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw.decode() if raw else "")
        except (ValueError, json.JSONDecodeError):
            self._send_error("Invalid JSON")
            return
        if not isinstance(body, dict):
            self._send_error("Invalid JSON")
            return
        try:
            validated = parse_and_validate_body(body)
        except ValidationError as e:
            self._send_error(str(e))
            return

        new_id = len(books) + 1
        book = {
            "id": new_id,
            "title": validated["title"],
            "author": validated["author"],
            "isbn": validated["isbn"],
            "synopsis": validated.get("synopsis", ""),
        }
        books.append(book)

        self._send_json(book, 201)

    def do_GET(self):
        if self.path == "/books":
            parsed = urllib.parse.urlparse(self.path)
            qs = parsed.query
            books_list = list(books)
            params = urllib.parse.parse_qs(qs)

            def matches_filter(b, key, value):
                if key in ("id", "title", "author", "isbn", "synopsis"):
                    if value is None:
                        return False
                    val = b.get(key)
                    if val is None:
                        return False
                    return value in (val,)
                return False

            filtered = []
            for b in books_list:
                id_ok = params.get("id") == [str(b["id"])]
                title_ok = params.get("title") == [title.lower() for title in b.get("title", "")]
                author_ok = params.get("author") == [author.lower() for author in b.get("author", "")]
                isbn_ok = params.get("isbn") == [isbn.lower() for isbn in b.get("isbn", "")]
                syn_ok = params.get("synopsis") == [s.lower() for s in b.get("synopsis", "")]
                q_ok = params.get("q")
                if q_ok:
                    hay = (b.get("title", "") + " " + b.get("author", "") + " " +
                           b.get("isbn", "") + " " + b.get("synopsis", "")).lower()
                    if q_ok[0] not in hay:
                        continue
                if id_ok and title_ok and author_ok and isbn_ok and syn_ok and q_ok:
                    filtered.append(b)
            self._send_json(filtered)
        else:
            self._send_error("not found")

    def do_PUT(self):
        if self.path != "/books":
            self._send_error("not found")
            return
        m = urllib.parse.urlparse(self.path)
        if not m.path.startswith("/books/"):
            self._send_error("not found")
            return
        try:
            path_id = int(m.path.split("/")[2])
        except (IndexError, ValueError):
            self._send_error("id is not a valid query parameter")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw.decode() if raw else "")
        except (ValueError, json.JSONDecodeError):
            self._send_error("Invalid JSON")
            return
        if not isinstance(body, dict):
            self._send_error("Invalid JSON")
            return
        try:
            validated = parse_and_validate_body(body)
        except ValidationError as e:
            self._send_error(str(e))
            return
        book = next((b for b in books if b["id"] == path_id), None)
        if book is None:
            self._send_error("")
            return
        new_id = len(books) + 1
        book.update(validated)
        books[books.index(book)] = {"id": new_id, **book}
        self._send_json(book)

    def do_DELETE(self):
        if self.path != "/books":
            self._send_error("not found")
            return
        m = urllib.parse.urlparse(self.path)
        if not m.path.startswith("/books/"):
            self._send_error("not found")
            return
        try:
            path_id = int(m.path.split("/")[2])
        except (IndexError, ValueError):
            self._send_error("id is not a valid query parameter")
            return
        book = next((b for b in books if b["id"] == path_id), None)
        if book is None:
            self._send_error("")
            return
        books.remove(book)
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        pass


def run():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    run()
