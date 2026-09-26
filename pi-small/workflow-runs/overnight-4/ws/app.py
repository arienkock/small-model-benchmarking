import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import os

class BookServer(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.books = {}  # id -> book dict
        self.next_id = 1

    def do_POST(self):
        if self.path == '/books':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, 'Empty body')
                return
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return

            # Validate required fields
            required = {'title', 'author', 'isbn'}
            missing = required - set(data.keys())
            if missing:
                self.send_error(400, f'Missing required field(s): {", ".join(missing)}')
                return
            if not data['title'] or not data['author'] or not data['isbn']:
                self.send_error(400, 'Empty title, author, or isbn')
                return

            book = {
                'id': self.next_id,
                'title': data['title'],
                'author': data['author'],
                'isbn': data['isbn'],
                'synopsis': data.get('synopsis', '')
            }
            self.books[self.next_id] = book
            self.next_id += 1
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
        else:
            self.send_error(404, 'Not found')

    def do_GET(self):
        if self.path == '/books':
            # Handle filtering and sorting
            query = self.path.split('?')[1] if self.path.startswith('/') else ''
            params = urllib.parse.urlparse(query).query
            books = list(self.books.values())
            
            # Apply filters
            id_filter = None
            title_filter = None
            author_filter = None
            isbn_filter = None
            synopsis_filter = None
            q_filter = None
            
            if 'id=' in params:
                try:
                    id_filter = int(params.split('=')[1])
                except ValueError:
                    self.send_error(400, 'Invalid id')
                    return
            elif 'title=' in params:
                title_filter = params.split('=')[1]
            elif 'author=' in params:
                author_filter = params.split('=')[1]
            elif 'isbn=' in params:
                isbn_filter = params.split('=')[1]
            elif 'synopsis=' in params:
                synopsis_filter = params.split('=')[1]
            elif 'q=' in params:
                q_filter = params.split('=')[1]
            else:
                # No filters, return all sorted by id
                pass
            
            # Apply all filters (AND logic)
            filtered = []
            for book in books:
                if id_filter is not None and book['id'] != id_filter:
                    continue
                if title_filter is not None and title_filter.lower() not in book['title'].lower():
                    continue
                if author_filter is not None and author_filter.lower() not in book['author'].lower():
                    continue
                if isbn_filter is not None and isbn_filter.lower() not in book['isbn'].lower():
                    continue
                if synopsis_filter is not None and synopsis_filter.lower() not in book['synopsis'].lower():
                    continue
                if q_filter is not None and q_filter.lower() not in book['title'].lower() or \
                   q_filter.lower() not in book['author'].lower() or \
                   q_filter.lower() not in book['isbn'].lower() or \
                   q_filter.lower() not in book['synopsis'].lower():
                    continue
                filtered.append(book)
            
            # Sort by id
            filtered.sort(key=lambda b: b['id'])
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(filtered).encode())
        elif self.path.startswith('/books/'):
            try:
                id_str = self.path.split('/', 1)[1]
                if not id_str.isdigit():
                    self.send_error(404, 'Invalid ID')
                    return
                book_id = int(id_str)
                if book_id not in self.books:
                    self.send_error(404, 'Book not found')
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(self.books[book_id]).encode())
            except ValueError:
                self.send_error(404, 'Invalid ID')
        else:
            self.send_error(404, 'Not found')

    def do_PUT(self):
        if self.path == '/books':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, 'Empty body')
                return
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return

            # Validate required fields
            required = {'title', 'author', 'isbn'}
            missing = required - set(data.keys())
            if missing:
                self.send_error(400, f'Missing required field(s): {", ".join(missing)}')
                return
            if not data['title'] or not data['author'] or not data['isbn']:
                self.send_error(400, 'Empty title, author, or isbn')
                return

            book_id = None
            if self.path.startswith('/books/'):
                try:
                    book_id = int(self.path.split('/', 1)[1])
                except ValueError:
                    self.send_error(400, 'Invalid ID')
                    return
            else:
                self.send_error(404, 'Not found')
                return

            if book_id not in self.books:
                self.send_error(404, 'Book not found')
                return

            # Update the book
            book = self.books[book_id]
            book['title'] = data.get('title', book['title'])
            book['author'] = data.get('author', book['author'])
            book['isbn'] = data.get('isbn', book['isbn'])
            book['synopsis'] = data.get('synopsis', book['synopsis'])

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(book).encode())
        else:
            self.send_error(404, 'Not found')

    def do_DELETE(self):
        if self.path == '/books':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, 'Empty body')
                return
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return

            # Validate required fields (optional for delete? The spec says replace title, author, isbn and synopsis with ones in body - but if not provided, keep existing. However, we should still validate that the body is valid JSON object. For simplicity, we can allow empty body or just check it's a dict.
            # Actually looking at the spec: "PUT /books/{id} replaces the book's title, author, isbn and synopsis with the ones in the body (same rules as create)." So PUT should require valid JSON object. But DELETE doesn't have a body requirement mentioned.
            # Let me check - for DELETE, there's no body specified. We can just accept any content-length 0 or non-empty but not required to be valid JSON? The spec says "PUT /books/{id} replaces..." with same rules as create (which requires valid JSON). For DELETE, it doesn't mention a body.
            # I'll make DELETE accept empty body or any content and just delete the book if id exists.
            
            try:
                book_id = int(self.path.split('/', 1)[1])
            except ValueError:
                self.send_error(400, 'Invalid ID')
                return

            if book_id not in self.books:
                self.send_error(404, 'Book not found')
                return

            del self.books[book_id]
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(404, 'Not found')

    def log_message(self, format, *args):
        # Suppress default logging
        pass

def run_server():
    port = int(os.environ.get('PORT', 8000))
    server = HTTPServer(('127.0.0.1', port), BookServer)
    print(f'Server starting on http://127.0.0.1:{port}')
    server.serve_forever()

if __name__ == '__main__':
    run_server()
