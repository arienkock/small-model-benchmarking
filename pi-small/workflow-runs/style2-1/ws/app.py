import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

books = {}
next_id = 1


class BookHandler(BaseHTTPRequestHandler):

    def _send_json(self, code, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if data:
            self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _parse_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            obj = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(obj, dict):
            return None
        return obj

    def _validate_and_build_book(self, data):
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val == "":
                return None, f"{field} is required and must be a non-empty string"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return None, "synopsis must be a string"
        return {
            "id": next_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis
        }, None

    def _handle_books_collection(self):
        if self.command == "GET":
            self._list_books()
        elif self.command == "POST":
            self._create_book()
        else:
            self._send_json(405, {"error": "Method not allowed"})

    def _list_books(self):
        result = list(books.values())
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        known_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        for key in qs:
            if key not in known_params:
                self._send_json(400, {"error": f"Unknown query parameter: {key}"})
                return

        if "id" in qs:
            try:
                target_id = int(qs["id"][0])
                result = [b for b in result if b["id"] == target_id]
            except ValueError:
                self._send_json(400, {"error": "id query parameter must be an integer"})
                return

        text_params = ("title", "author", "isbn", "synopsis")
        for field in text_params:
            if field in qs:
                val = qs[field][0].lower()
                result = [b for b in result if val in b[field].lower()]

        if "q" in qs:
            val = qs["q"][0].lower()
            result = [b for b in result if any(val in b[f].lower() for f in text_params)]

        self._send_json(200, result)

    def _create_book(self):
        data = self._parse_json_body()
        if data is None:
            self._send_json(400, {"error": "Request body must be a JSON object"})
            return
        if "id" in data:
            self._send_json(400, {"error": "id must not be provided in request body"})
            return
        book, err = self._validate_and_build_book(data)
        if err:
            self._send_json(400, {"error": err})
            return
        global next_id
        books[book["id"]] = book
        next_id += 1
        self._send_json(201, dict(book))

    def _single_book_route(self):
        parsed = urlparse(self.path)
        parts = parsed.path.split("/")
        try:
            book_id = int(parts[2])
        except ValueError:
            self._send_json(400, {"error": f"Invalid id '{parts[2]}', must be an integer"})
            return
        if self.command == "GET":
            book = books.get(book_id)
            if book is None:
                self._send_json(404, {"error": f"Book with id {book_id} not found"})
                return
            self._send_json(200, book)
        elif self.command == "PUT":
            book = books.get(book_id)
            if book is None:
                self._send_json(404, {"error": f"Book with id {book_id} not found"})
                return
            data = self._parse_json_body()
            if data is None:
                self._send_json(400, {"error": "Request body must be a JSON object"})
                return
            for field in ("title", "author", "isbn"):
                val = data.get(field)
                if not isinstance(val, str) or val == "":
                    self._send_json(400, {"error": f"{field} is required and must be a non-empty string"})
                    return
            synopsis = data.get("synopsis", "")
            if not isinstance(synopsis, str):
                self._send_json(400, {"error": "synopsis must be a string"})
                return
            book["title"] = data["title"]
            book["author"] = data["author"]
            book["isbn"] = data["isbn"]
            book["synopsis"] = synopsis
            self._send_json(200, dict(book))
        elif self.command == "DELETE":
            if book_id not in books:
                self._send_json(404, {"error": f"Book with id {book_id} not found"})
                return
            del books[book_id]
            self._send_json(204)
        else:
            self._send_json(405, {"error": "Method not allowed"})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        parts = path.split("/")
        if len(parts) == 2 and parts[1] == "books":
            self._handle_books_collection()
        elif len(parts) == 3 and parts[1] == "books":
            self._single_book_route()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if len(path.split("/")) == 2 and path.split("/")[1] == "books":
            self._handle_books_collection()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            self._single_book_route()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            self._single_book_route()
        else:
            self._send_json(404, {"error": "Not found"})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = HTTPServer(("127.0.0.1", port), BookHandler)
    print(f"Server running on http://127.0.0.1:{port}")
    server.serve_forever()
