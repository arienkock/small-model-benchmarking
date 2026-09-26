import os
import http.server
import json
import urllib.parse

PORT = int(os.environ.get("PORT", 8000))
HOST = "127.0.0.1"

store = {}
next_id = 1


def _flatten_params(params):
    return {k: v[0] for k, v in params.items()}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code, msg):
        self._send_json(code, {"error": msg})

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        return raw

    def _parse_json_body(self):
        raw = self._read_body()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self._send_error(400, "Invalid JSON")
            return None
        if not isinstance(data, dict):
            self._send_error(400, "Expected JSON object")
            return None
        return data

    def _validate_book_fields(self, data):
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or not val:
                self._send_error(400, f"Missing or empty '{field}'")
                return False
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            self._send_error(400, "Invalid 'synopsis' type")
            return False
        return True

    def _find_book_path(self, path):
        parts = path.rstrip("/").split("/")
        if len(parts) == 2 and parts[1] == "books":
            return "/books", None
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                return None, (400, "Invalid id")
            return f"/books/{book_id}", book_id
        return None, None

    def _filter_books(self, params):
        flat = _flatten_params(params)
        results = list(store.values())
        valid_keys = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown = set(flat.keys()) - valid_keys
        if unknown:
            key = next(iter(unknown))
            self._send_error(400, f"Unknown query parameter: {key}")
            return None

        id_val = flat.get("id")
        if id_val is not None:
            try:
                rid = int(id_val)
            except ValueError:
                self._send_error(400, "Invalid id filter")
                return None
            results = [b for b in results if b["id"] == rid]

        search_all = flat.get("q", "")
        filters = {}
        for f in ("title", "author", "isbn", "synopsis"):
            v = flat.get(f)
            if v is not None:
                filters[f] = v.lower()

        filtered = []
        for book in results:
            match = True
            if search_all:
                sa_lower = search_all.lower()
                if not any(
                    sa_lower in str(book.get(k, "")).lower()
                    for k in ("title", "author", "isbn", "synopsis")
                ):
                    match = False
            for f, v in filters.items():
                if f != "id" and v not in book.get(f, "").lower():
                    match = False
            if match:
                filtered.append(book)

        return sorted(filtered, key=lambda b: b["id"])

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

        target, book_id = self._find_book_path(path)
        if target is None:
            self._send_error(404, "Not found")
            return

        if target == "/books" and book_id is None:
            results = self._filter_books(params)
            if results is None:
                return
            self._send_json(200, results)
            return

        if isinstance(book_id, int):
            if book_id not in store:
                self._send_error(404, "Not found")
                return
            self._send_json(200, dict(store[book_id]))
            return

        err = book_id  # tuple of (code, msg)
        self._send_error(err[0], err[1])

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path != "/books":
            parts = path.split("/")
            if len(parts) == 3 and parts[1] == "books":
                self._send_error(404, "Not found")
                return
            self._send_error(404, "Not found")
            return

        data = self._parse_json_body()
        if data is None:
            return

        if "id" in data:
            self._send_error(400, "id must not be supplied by client")
            return

        if not self._validate_book_fields(data):
            return

        global next_id
        book = {
            "id": next_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": data.get("synopsis", ""),
        }
        store[next_id] = book
        next_id += 1
        self._send_json(201, dict(book))

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        target, book_id = self._find_book_path(path)

        if book_id is None or target != f"/books/{book_id}":
            self._send_error(404, "Not found")
            return

        if book_id not in store:
            self._send_error(404, "Not found")
            return

        data = self._parse_json_body()
        if data is None:
            return

        if "id" in data:
            self._send_error(400, "id must not be supplied by client")
            return

        if not self._validate_book_fields(data):
            return

        store[book_id] = {
            "id": book_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": data.get("synopsis", ""),
        }
        self._send_json(200, dict(store[book_id]))

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        target, book_id = self._find_book_path(path)

        if book_id is None or target != f"/books/{book_id}":
            self._send_error(404, "Not found")
            return

        if book_id not in store:
            self._send_error(404, "Not found")
            return

        del store[book_id]
        self.send_response(204)
        self.end_headers()


server = http.server.HTTPServer((HOST, PORT), Handler)
print(f"Serving on {HOST}:{PORT}")
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
