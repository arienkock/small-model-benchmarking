import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


books = {}
next_id = 1


class BookHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_no_content(self):
        self.send_response(204)
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        return self.rfile.read(length)

    def _parse_json_body(self):
        raw = self._read_body()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _error(self, code, msg):
        self._send_json(code, {"error": msg})

    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query, keep_blank_values=True)

        if path == "/books" and method == "GET":
            return self._list_books(params)
        if path == "/books" and method == "POST":
            return self._create_book()
        book_match = None
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                bid = int(parts[2])
            except ValueError:
                return self._error(400, "Invalid id in path")
            book_match = (bid, parts[2])

        if book_match is None:
            return self._error(404, "Not found")

        bid, raw_id = book_match

        if method == "GET":
            return self._get_book(bid)
        if method == "PUT":
            return self._update_book(bid)
        if method == "DELETE":
            return self._delete_book(bid)
        return self._error(404, "Not found")

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_DELETE(self):
        self._route("DELETE")

    def _create_book(self):
        data = self._parse_json_body()
        if data is None:
            return self._error(400, "Invalid JSON body")
        if "id" in data:
            return self._error(400, "id must not be supplied by client")
        for field in ("title", "author", "isbn"):
            if field not in data or not isinstance(data[field], str) or data[field].strip() == "":
                return self._error(400, f"Invalid or missing {field}")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")
        global next_id
        book = {"id": next_id, "title": data["title"], "author": data["author"], "isbn": data["isbn"], "synopsis": synopsis}
        books[next_id] = book
        next_id += 1
        self._send_json(201, book)

    def _get_book(self, bid):
        book = books.get(bid)
        if book is None:
            return self._error(404, "Book not found")
        self._send_json(200, book)

    def _update_book(self, bid):
        data = self._parse_json_body()
        if data is None:
            return self._error(400, "Invalid JSON body")
        for field in ("title", "author", "isbn"):
            if field not in data or not isinstance(data[field], str) or data[field].strip() == "":
                return self._error(400, f"Invalid or missing {field}")
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return self._error(400, "synopsis must be a string")
        book = books.get(bid)
        if book is None:
            return self._error(404, "Book not found")
        book["title"] = data["title"]
        book["author"] = data["author"]
        book["isbn"] = data["isbn"]
        book["synopsis"] = synopsis
        self._send_json(200, book)

    def _delete_book(self, bid):
        if bid not in books:
            return self._error(404, "Book not found")
        del books[bid]
        self._send_no_content()

    def _list_books(self, params):
        valid_keys = {"id", "title", "author", "isbn", "synopsis", "q"}
        param_keys = set(params.keys())
        unknown = param_keys - valid_keys
        if unknown:
            return self._error(400, f"Unknown query parameter: {next(iter(unknown))}")

        results = list(books.values())

        # Filter by id (must be integer)
        if "id" in params:
            val = params["id"][0]
            try:
                fid = int(val)
            except ValueError:
                return self._error(400, "id must be an integer")
            results = [b for b in results if b["id"] == fid]

        # Filters
        for field in ("title", "author", "isbn", "synopsis"):
            if field in params:
                needle = params[field][0].lower()
                results = [b for b in results if needle in b[field].lower()]

        if "q" in params:
            needle = params["q"][0].lower()
            results = [b for b in results if any(needle in b[f].lower() for f in ("title", "author", "isbn", "synopsis"))]

        results.sort(key=lambda b: b["id"])
        self._send_json(200, results)


def main():
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Listening on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
