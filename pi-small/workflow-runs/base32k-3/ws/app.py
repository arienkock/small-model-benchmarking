import http.server
import json
import os
import urllib.parse
import threading


class BookStore:
    def __init__(self):
        self.books = {}
        self.next_id = 1

    def create(self, data):
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val == "":
                return None, f"missing or empty '{field}'"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return None, "'synopsis' must be a string"
        book = {
            "id": self.next_id,
            "title": data["title"],
            "author": data["author"],
            "isbn": data["isbn"],
            "synopsis": synopsis,
        }
        self.books[self.next_id] = book
        self.next_id += 1
        return book, None

    def get(self, book_id):
        return self.books.get(book_id)

    def update(self, book_id, data):
        for field in ("title", "author", "isbn"):
            val = data.get(field)
            if not isinstance(val, str) or val == "":
                return None, f"missing or empty '{field}'"
        synopsis = data.get("synopsis", "")
        if not isinstance(synopsis, str):
            return None, "'synopsis' must be a string"
        book = self.books.get(book_id)
        if book is None:
            return None, f"book with id {book_id} not found"
        book["title"] = data["title"]
        book["author"] = data["author"]
        book["isbn"] = data["isbn"]
        book["synopsis"] = synopsis
        return book, None

    def delete(self, book_id):
        if book_id in self.books:
            del self.books[book_id]
            return True
        return False

    def list_books(self, params):
        known_params = {"id", "title", "author", "isbn", "synopsis", "q"}
        results = list(self.books.values())

        for key, value in params.items():
            if key not in known_params:
                return None, f"unknown query parameter '{key}'"
            val = value[0] if value else ""

            if key == "id":
                try:
                    int_id = int(val)
                except ValueError:
                    results = [b for b in results if False]
                    break
                results = [b for b in results if b["id"] == int_id]
            elif key == "q":
                low = val.lower()
                results = [
                    b
                    for b in results
                    if low in b["title"].lower()
                    or low in b["author"].lower()
                    or low in b["isbn"].lower()
                    or low in b["synopsis"].lower()
                ]
            else:
                low = val.lower()
                results = [b for b in results if low in b[key].lower()]

        results.sort(key=lambda b: b["id"])
        return results, None


store = BookStore()


class RequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence logs

    def _send_json(self, code, data=None):
        body = json.dumps(data).encode("utf-8") if data is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return "INVALID_JSON"

    def _parse_path(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = urllib.parse.parse_qs(parsed.query)
        return path, params

    def do_GET(self):
        path, params = self._parse_path()

        if path == "/books":
            results, err = store.list_books(params)
            if err:
                self._send_json(400, {"error": err})
                return
            self._send_json(200, results)
            return

        # GET /books/{id}
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "invalid id"})
                return
            book = store.get(book_id)
            if book is None:
                self._send_json(404, {"error": f"book with id {book_id} not found"})
                return
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        path, params = self._parse_path()

        if path == "/books" and not params:
            data = self._read_body()
            if data == "INVALID_JSON" or data is None:
                self._send_json(400, {"error": "invalid JSON body"})
                return
            if not isinstance(data, dict):
                self._send_json(400, {"error": "request body must be a JSON object"})
                return
            if any(k in data for k in ("id",)):
                self._send_json(400, {"error": "'id' must not be supplied by client"})
                return
            book, err = store.create(data)
            if err:
                self._send_json(400, {"error": err})
                return
            self._send_json(201, book)
            return

        self._send_json(404, {"error": "not found"})

    def do_PUT(self):
        path, params = self._parse_path()

        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "invalid id"})
                return

            data = self._read_body()
            if data == "INVALID_JSON" or data is None:
                self._send_json(400, {"error": "invalid JSON body"})
                return
            if not isinstance(data, dict):
                self._send_json(400, {"error": "request body must be a JSON object"})
                return
            if any(k in data for k in ("id",)):
                self._send_json(400, {"error": "'id' must not be supplied by client"})
                return

            book, err = store.update(book_id, data)
            if err:
                if "not found" in err:
                    self._send_json(404, {"error": err})
                else:
                    self._send_json(400, {"error": err})
                return
            self._send_json(200, book)
            return

        self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        path, params = self._parse_path()

        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "books":
            try:
                book_id = int(parts[2])
            except ValueError:
                self._send_json(400, {"error": "invalid id"})
                return

            if not store.delete(book_id):
                self._send_json(404, {"error": f"book with id {book_id} not found"})
                return
            # 204 No Content — no body sent
            self.send_response(204)
            self.end_headers()
            return

        self._send_json(404, {"error": "not found"})


class ThreadedHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def process_request(self, request, client_address):
        t = threading.Thread(target=self.process_request_thread, args=(request, client_address))
        t.daemon = True
        t.start()

    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = ThreadedHTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"Listening on 127.0.0.1:{port}")
    server.serve_forever()
