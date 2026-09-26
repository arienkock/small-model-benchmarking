"""
Simple HTTP server for book API.
Supports:
- POST /books - create book
- GET /books/{id} - get book by id
- GET /books - list books with filters
- PUT /books/{id} - update book
- DELETE /books/{id} - delete book
"""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread
import os


class BookHandler(BaseHTTPRequestHandler):
    books = []
    next_id = 1
    
    def do_POST(self):
        content_length = int(self.request.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error_response(400, {"error": "invalid JSON"})
            return
        
        body = self.request.body.decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error_response(400, {"error": "invalid JSON"})
            return
        
        # Validate required fields
        title = data.get('title')
        author = data.get('author')
        isbn = data.get('isbn')
        
        if not isinstance(title, str) or not title:
            self.send_error_response(400, {"error": "title is empty"})
            return
        if not isinstance(author, str) or not author:
            self.send_error_response(400, {"error": "author is empty"})
            return
        if not isinstance(isbn, str) or not isbn:
            self.send_error_response(400, {"error": "isbn is empty"})
            return
        
        # No id in body for create
        if 'id' in data:
            self.send_error_response(400, {"error": "id is not allowed in body"})
            return
        
        # Create book
        book = {
            'id': BookHandler.next_id,
            'title': title,
            'author': author,
            'isbn': isbn,
            'synopsis': ''
        }
        BookHandler.books.append(book)
        BookHandler.next_id += 1
        
        self.send_json_response(201, book)
    
    def do_GET(self, path):
        if path == '/books':
            self.handle_get_all()
        elif path.startswith('/books/') and path != '/books':
            # Extract id
            parts = path.split('/')
            if len(parts) == 3 and parts[1] == 'books':
                try:
                    book_id = int(parts[2])
                    self.handle_get_book(book_id)
                except ValueError:
                    self.send_error_response(400, {"error": "id must be an integer"})
                    return
            else:
                self.send_error_response(400, {"error": "unknown path"})
        else:
            self.send_error_response(404, {})
    
    def send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def send_error_response(self, status_code, error_obj):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(error_obj).encode('utf-8'))
    
    def handle_get_all(self):
        # Get all books, ordered by id
        all_books = sorted(BookHandler.books, key=lambda b: b['id'])
        
        # Parse query parameters
        params = {}
        query_str = self.path.split('?')[1] if '?' in self.path else ''
        if query_str:
            for pair in query_str.split('&'):
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    params[k] = v
        
        # Filter based on parameters
        filtered = all_books
        
        # id=<n> - keep only the book with that id
        id_param = params.get('id')
        if id_param is not None:
            try:
                book_id = int(id_param)
                filtered = [b for b in filtered if b['id'] == book_id]
            except ValueError:
                self.send_error_response(400, {"error": "unknown query parameter"})
                return
        
        # title, author, isbn, synopsis filters
        title_filter = params.get('title')
        author_filter = params.get('author')
        isbn_filter = params.get('isbn')
        synopsis_filter = params.get('synopsis')
        
        def matches_case_insensitive(field, value):
            if value is None:
                return True
            field_val = field.get(field, '')
            return field_val.lower() == value.lower()
        
        if title_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, title_filter)]
        if author_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, author_filter)]
        if isbn_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, isbn_filter)]
        if synopsis_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, synopsis_filter)]
        
        # q=… filter - keep books where any of title, author, isbn or synopsis contains the value
        q_filter = params.get('q')
        if q_filter:
            # If q_filter is provided along with other filters, all must match
            # For id filter we already handled id=<n>, so q works with other fields too
            # q filter: book matches if any field contains q_filter (case-insensitive)
            # For q to work with other filters (like id), we need id filter as separate rule.
            # The spec says "several parameters together must all match"
            # If id=1 and q=foo, then book id must be 1 AND id=1 must match? Actually id=1 is a separate check.
            # id filter is "keep only the book with that id", so if id=1 and q=foo, the book id=1 must also match q?
            # Probably q is only meaningful when not id filter.
            # Let's interpret: id filter is a separate requirement; q works with title/author/isbn/synopsis.
            # But spec says "several parameters together must all match." So id=1 and q=foo both must match.
            # For id=1, matching means the book's id == 1, which is always true for the one book.
            # So q=foo means also check title/author/isbn/synopsis contains foo.
            # That's fine.
            filtered = [b for b in filtered if (
                q_filter.lower() in b['title'].lower() or
                q_filter.lower() in b['author'].lower() or
                q_filter.lower() in b['isbn'].lower() or
                q_filter.lower() in b['synopsis'].lower()
            )]
        
        # For id filter, if id filter is present, q filter still applies as above
        # Also ensure multiple parameters match: id and q both apply together
        # If only q filter is given, apply it
        
        self.send_json_response(200, filtered)
    
    def handle_get_book(self, book_id):
        # Get book by id
        book = None
        for b in BookHandler.books:
            if b['id'] == book_id:
                book = b
                break
        
        if book is None:
            self.send_error_response(404, {})
            return
        
        # Query params also apply for /books/{id} endpoint per spec
        params = {}
        query_str = self.path.split('?')[1] if '?' in self.path else ''
        if query_str:
            for pair in query_str.split('&'):
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    params[k] = v
        
        # id filter (id=<n>) is redundant since we already have specific id,
        # but handle it for completeness
        id_param = params.get('id')
        if id_param is not None:
            try:
                book_id_int = int(id_param)
                if book_id != book_id_int:
                    self.send_error_response(400, {"error": "unknown query parameter"})
                    return
            except ValueError:
                self.send_error_response(400, {"error": "unknown query parameter"})
                return
        
        # Other filters
        title_filter = params.get('title')
        author_filter = params.get('author')
        isbn_filter = params.get('isbn')
        synopsis_filter = params.get('synopsis')
        
        def matches_case_insensitive(field, value):
            if value is None:
                return True
            field_val = field.get(field, '')
            return field_val.lower() == value.lower()
        
        filtered = [book]
        
        if title_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, title_filter)]
        if author_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, author_filter)]
        if isbn_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, isbn_filter)]
        if synopsis_filter:
            filtered = [b for b in filtered if matches_case_insensitive(b, synopsis_filter)]
        q_filter = params.get('q')
        if q_filter:
            filtered = [b for b in filtered if (
                q_filter.lower() in b['title'].lower() or
                q_filter.lower() in b['author'].lower() or
                q_filter.lower() in b['isbn'].lower() or
                q_filter.lower() in b['synopsis'].lower()
            )]
        
        if len(filtered) != 1:
            self.send_error_response(400, {"error": "unknown query parameter"})
            return
        
        self.send_json_response(200, filtered[0])
    
    # We'll implement PUT and DELETE in a later phase
    def do_PUT(self):
        # Stub for later
        self.send_error_response(501, {})
        return
    
    def do_DELETE(self):
        # Stub for later
        self.send_error_response(501, {})
        return


def run_server(port=8000):
    server = HTTPServer(('127.0.0.1', port), BookHandler)
    server.serve_forever()


if __name__ == '__main__':
    port = os.environ.get('PORT', 8000)
    run_server(port)
