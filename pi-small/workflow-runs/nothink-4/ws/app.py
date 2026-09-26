import http.server
import json
import urllib.parse
import threading

# In-memory storage
books = {}
next_id = 1
lock = threading.Lock()


class BookHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress logs

    def send_json(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, code, message):
        self.send_json(code, {"error": message})

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw)

    def parse_path(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/')
        if not path:
            path = '/'
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        return path, query

    def do_GET(self):
        path, query = self.parse_path()

        if path == '/books':
            self.handle_get_books(query)
        elif path.startswith('/books/'):
            parts = path.split('/')
            if len(parts) == 3 and parts[1] == 'books' and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    self.send_error_json(400, "Invalid id")
                    return
                self.handle_get_book(book_id)
            else:
                self.send_error_json(404, "Not found")
        else:
            self.send_error_json(404, "Not found")

    def do_POST(self):
        path, query = self.parse_path()

        if path == '/books':
            try:
                data = self.read_body()
            except (json.JSONDecodeError, Exception):
                self.send_error_json(400, "Invalid JSON")
                return
            if not isinstance(data, dict):
                self.send_error_json(400, "Invalid JSON object")
                return
            self.handle_create_book(data)
        else:
            self.send_error_json(404, "Not found")

    def do_PUT(self):
        path, query = self.parse_path()

        if path.startswith('/books/'):
            parts = path.split('/')
            if len(parts) == 3 and parts[1] == 'books' and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    self.send_error_json(400, "Invalid id")
                    return
                try:
                    data = self.read_body()
                except (json.JSONDecodeError, Exception):
                    self.send_error_json(400, "Invalid JSON")
                    return
                if not isinstance(data, dict):
                    self.send_error_json(400, "Invalid JSON object")
                    return
                self.handle_update_book(book_id, data)
            else:
                self.send_error_json(404, "Not found")
        else:
            self.send_error_json(404, "Not found")

    def do_DELETE(self):
        path, query = self.parse_path()

        if path.startswith('/books/'):
            parts = path.split('/')
            if len(parts) == 3 and parts[1] == 'books' and parts[2]:
                try:
                    book_id = int(parts[2])
                except ValueError:
                    self.send_error_json(400, "Invalid id")
                    return
                self.handle_delete_book(book_id)
            else:
                self.send_error_json(404, "Not found")
        else:
            self.send_error_json(404, "Not found")

    def validate_required_fields(self, data):
        for field in ['title', 'author', 'isbn']:
            if field not in data:
                return f"Missing required field: {field}"
            val = data[field]
            if not isinstance(val, str) or val.strip() == '':
                return f"Field '{field}' must be a non-empty string"
        if 'synopsis' in data:
            if not isinstance(data['synopsis'], str):
                return "Field 'synopsis' must be a string"
        return None

    def handle_create_book(self, data):
        global next_id
        err = self.validate_required_fields(data)
        if err:
            self.send_error_json(400, err)
            return

        if 'id' in data:
            self.send_error_json(400, "id must not be supplied")
            return

        with lock:
            book_id = next_id
            next_id += 1
            book = {
                'id': book_id,
                'title': data['title'],
                'author': data['author'],
                'isbn': data['isbn'],
                'synopsis': data.get('synopsis', '')
            }
            books[book_id] = book

        self.send_json(201, book)

    def handle_get_book(self, book_id):
        with lock:
            book = books.get(book_id)
        if book is None:
            self.send_error_json(404, "Book not found")
            return
        self.send_json(200, book)

    def handle_update_book(self, book_id, data):
        err = self.validate_required_fields(data)
        if err:
            self.send_error_json(400, err)
            return

        with lock:
            book = books.get(book_id)
            if book is None:
                self.send_error_json(404, "Book not found")
                return
            book['title'] = data['title']
            book['author'] = data['author']
            book['isbn'] = data['isbn']
            book['synopsis'] = data.get('synopsis', '')

        self.send_json(200, book)

    def handle_delete_book(self, book_id):
        with lock:
            if book_id not in books:
                self.send_error_json(404, "Book not found")
                return
            del books[book_id]
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def handle_get_books(self, query):
        valid_params = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}
        for key in query:
            if key not in valid_params:
                self.send_error_json(400, f"Unknown query parameter: {key}")
                return

        with lock:
            result = list(books.values())

        # Filter by id
        if 'id' in query:
            try:
                target_id = int(query['id'][0])
            except ValueError:
                self.send_error_json(400, "Invalid id parameter")
                return
            result = [b for b in result if b['id'] == target_id]

        # Filter by fields (case-insensitive contains)
        for field in ['title', 'author', 'isbn', 'synopsis']:
            if field in query:
                val = query[field][0].lower()
                result = [b for b in result if val in b[field].lower()]

        # Global search
        if 'q' in query:
            val = query['q'][0].lower()
            result = [b for b in result if any(val in b[f].lower() for f in ['title', 'author', 'isbn', 'synopsis'])]

        # Sort by id
        result.sort(key=lambda b: b['id'])
        self.send_json(200, result)


def run_server(port):
    server = http.server.HTTPServer(('127.0.0.1', port), BookHandler)
    print(f"Server running on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8000))
    run_server(port)
