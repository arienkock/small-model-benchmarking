import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


books = {}
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if body:
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_header("Content-Length", "0")
            self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        return raw

    def _parse_json_body(self):
        raw = self._read_body()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self._send_json(400, {"error": "invalid JSON"})
            return None
        if not isinstance(data, dict):
            self._send_json(400, {"error": "expected JSON object"})
            return None
        return data

    def _validate_book(self, data):
        if "id" in data:
            self._send_json(400, {"error": "id must not be supplied by the client"})
            return None
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or not val:
                self._send_json(400, {"error": f"field '{field}' is required and must be a non-empty string"})
                return None
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            self._send_json(400, {"error": "field 'synopsis' must be a string"})
            return None
        return {"title": data["title"], "author": data["author"], "isbn": data["isbn"], "synopsis": synopsis}

    def _split_path(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        parts = [p for p in path.split("/") if p]
        return parsed, parts

    def _do_create(self):
        global next_id
        data = self._parse_json_body()
        if data is None:
            return
        book = self._validate_book(data)
        if book is None:
            return
        bid = next_id
        next_id += 1
        book["id"] = bid
        books[bid] = book
        self._send_json(201, book)

    def _do_read(self, parts):
        if len(parts) != 2:
            self._send_json(404, {"error": "not found"})
            return
        try:
            bid = int(parts[1])
        except ValueError:
            self._send_json(400, {"error": "id must be an integer"})
            return
        if bid not in books:
            self._send_json(404, {"error": "book not found"})
            return
        self._send_json(200, books[bid])

    def _do_update(self, parts):
        if len(parts) != 2:
            self._send_json(404, {"error": "not found"})
            return
        try:
            bid = int(parts[1])
        except ValueError:
            self._send_json(400, {"error": "id must be an integer"})
            return
        if bid not in books:
            self._send_json(404, {"error": "book not found"})
            return
        data = self._parse_json_body()
        if data is None:
            return
        book = self._validate_book(data)
        if book is None:
            return
        book["id"] = bid
        books[bid] = book
        self._send_json(200, book)

    def _do_delete(self, parts):
        if len(parts) != 2:
            self._send_json(404, {"error": "not found"})
            return
        try:
            bid = int(parts[1])
        except ValueError:
            self._send_json(400, {"error": "id must be an integer"})
            return
        if bid not in books:
            self._send_json(404, {"error": "book not found"})
            return
        del books[bid]
        self._send_json(204)

    def _do_list(self):
        parsed, parts = self._split_path()
        if parts != ["books"]:
            self._send_json(404, {"error": "not found"})
            return
        params = parse_qs(parsed.query, keep_blank_values=True)

        valid_keys = {"id", "title", "author", "isbn", "synopsis", "q"}
        unknown = set(params.keys()) - valid_keys
        if unknown:
            self._send_json(400, {"error": f"unknown query parameter: {', '.join(sorted(unknown))}"})
            return

        result = list(books.values())

        if "id" in params:
            val = params["id"][0]
            try:
                target_id = int(val)
            except ValueError:
                self._send_json(400, {"error": "id must be an integer"})
                return
            result = [b for b in result if b["id"] == target_id]

        if "q" in params:
            q = params["q"][0].lower()
            result = [b for b in result if any(q in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))]

        for field in ("title", "author", "isbn", "synopsis"):
            if field in params:
                val = params[field][0].lower()
                result = [b for b in result if val in str(b[field]).lower()]

        result.sort(key=lambda b: b["id"])
        self._send_json(200, result)

    def do_GET(self):
        parsed, parts = self._split_path()
        if parts == ["books"]:
            self._do_list()
        elif len(parts) == 2 and parts[0] == "books":
            self._do_read(parts)
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        _, parts = self._split_path()
        if parts == ["books"]:
            self._do_create()
        else:
            self._send_json(404, {"error": "not found"})

    def do_PUT(self):
        _, parts = self._split_path()
        if len(parts) == 2 and parts[0] == "books":
            self._do_update(parts)
        else:
            self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        _, parts = self._split_path()
        if len(parts) == 2 and parts[0] == "books":
            self._do_delete(parts)
        else:
            self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on 127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
