import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "8000"))
HOST = "127.0.0.1"

_lock = threading.Lock()
_books = {}
_next_id = 1


def _error(status, message):
    body = json.dumps({"error": message})
    if status == 204:
        return None
    return body, status


def _parse_body(handler):
    """Return (data, error_response)."""
    length = None
    try:
        length = int(handler.headers.get("Content-Length", 0))
    except (TypeError, ValueError):
        length = 0
    raw = b""
    try:
        raw = handler.rfile.read(length) if length > 0 else b""
    except Exception:
        raw = b""
    try:
        data = json.loads(raw.decode("utf-8")) if raw else None
    except Exception:
        return None, _error(400, "Request body is not valid JSON")
    if not isinstance(data, dict):
        return None, _error(400, "Request body must be a JSON object")
    return data, None


def _validate_fields(data):
    """Validate book creation/update fields. Returns (fields, error)."""
    fields = {}
    for field in ("title", "author", "isbn"):
        if field not in data:
            return None, _error(400, f"Missing required field: {field}")
        value = data[field]
        if not isinstance(value, str) or value == "":
            return None, _error(400, f"Field '{field}' must be a non-empty string")
        fields[field] = value
    synopsis = data.get("synopsis", "")
    if synopsis != "":
        if not isinstance(synopsis, str):
            return None, _error(400, "Field 'synopsis' must be a string")
        fields["synopsis"] = synopsis
    else:
        fields["synopsis"] = ""
    if "id" in data:
        return None, _error(400, "Field 'id' must not be supplied")
    return fields, None


def _make_book(fields, book_id):
    return {
        "id": book_id,
        "title": fields["title"],
        "author": fields["author"],
        "isbn": fields["isbn"],
        "synopsis": fields["synopsis"],
    }


def _book_matches(book, query):
    qid = query.get("id")
    if qid is not None:
        return str(book["id"]) == qid
    for field, op in (("title", "title"), ("author", "author"),
                      ("isbn", "isbn"), ("synopsis", "synopsis")):
        if field in query:
            values = query[field]
            if field == "q":
                vals = [str(v).lower() for v in values]
            else:
                v = str(values[0]).lower()
                vals = [v]
            if not any(str(book[field]).lower() == v for v in vals):
                return False
    return True


def _handle_list(handler, path, query, body=None):
    parsed = urlparse(path)
    params = parse_qs(parsed.query)
    known = {"id", "title", "author", "isbn", "synopsis", "q"}
    unknown = [k for k in params if k not in known]
    if unknown:
        return _error(400, "Unknown query parameter(s): " + ", ".join(sorted(set(unknown))))

    with _lock:
        matching = [
            b for b in _books.values()
            if _book_matches(b, params)
        ]
    ordered = sorted(matching, key=lambda b: b["id"])
    body = json.dumps(ordered)
    handler._send(body, 200)
    return None


def _require_id(path, handler):
    """Extract and validate the id from /books/{id}. Returns (id, error)."""
    parts = [p for p in path.split("/") if p != ""]
    if parts != ["books"] or len(parts) != 2:
        return None, _error(404, "Not found")
    raw = parts[1]
    try:
        book_id = int(raw)
    except (TypeError, ValueError):
        return None, _error(404, "Not found")
    return book_id, None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, body, status, content_type="application/json"):
        if body is None:
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_post_books(self, body):
        data, err = _parse_body(self)
        if err:
            return self._send(err[1], err[0])
        fields, err = _validate_fields(data)
        if err:
            return self._send(err[1], err[0])
        global _next_id
        with _lock:
            book_id = _next_id
            _next_id += 1
            _books[book_id] = _make_book(fields, book_id)
        book = _books[book_id]
        return self._send(json.dumps(book), 201)

    def _handle_get_books(self, path):
        _handle_list(self, path, parse_qs(urlparse(path).query))
        return None

    def _handle_get_book(self, path):
        book_id, err = _require_id(path, self)
        if err:
            return self._send(err[1], err[0])
        with _lock:
            book = _books.get(book_id)
        if book is None:
            return self._send(_error(404, "Not found")[1], 404)
        return self._send(json.dumps(book), 200)

    def _handle_put_book(self, path, body):
        book_id, err = _require_id(path, self)
        if err:
            return self._send(err[1], err[0])
        data, err = _parse_body(self)
        if err:
            return self._send(err[1], err[0])
        fields, err = _validate_fields(data)
        if err:
            return self._send(err[1], err[0])
        with _lock:
            if book_id not in _books:
                return self._send(_error(404, "Not found")[1], 404)
            _books[book_id] = _make_book(fields, book_id)
        book = _books[book_id]
        return self._send(json.dumps(book), 200)

    def _handle_delete_book(self, path):
        book_id, err = _require_id(path, self)
        if err:
            return self._send(err[1], err[0])
        with _lock:
            if book_id not in _books:
                return self._send(_error(404, "Not found")[1], 404)
            del _books[book_id]
        return self._send(None, 204)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/books":
            return self._handle_get_books(path)
        return self._handle_get_book(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/books":
            return self._send(_error(404, "Not found")[1], 404)
        return self._handle_post_books(None)

    def do_PUT(self):
        parsed = urlparse(self.path)
        book_id, ok = _require_id(parsed.path, self)
        if not ok:
            return self._send(ok[1], ok[0])
        return self._handle_put_book(parsed.path, None)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        book_id, ok = _require_id(parsed.path, self)
        if not ok:
            return self._send(ok[1], ok[0])
        return self._handle_delete_book(parsed.path)

    def log_message(self, fmt, *args):
        pass


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
