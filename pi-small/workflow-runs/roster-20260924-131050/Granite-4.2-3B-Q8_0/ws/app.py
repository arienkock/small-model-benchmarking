import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

class BookHandler(BaseHTTPRequestHandler):
    books = []          # list sorted by id
    book_by_id = {}     # id -> book
    next_id = 1

    def is_json(self):
        return self.headers.get('Content-Type', '').startswith('application/json')

    def send_json_response(self, status_code, data=None):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if data is None:
            self.wfile.write(json.dumps({}).encode())
        else:
            self.wfile.write(json.dumps(data).encode())

    def validate_query_params(self, params):
        # allowed: id, title, author, isbn, synopsis, q
        allowed = {'id', 'title', 'author', 'isbn', 'synopsis', 'q'}
        seen = set()
        for k, v in params.items():
            if k not in allowed:
                raise ValueError(f"unknown query parameter {k}")
            if k != 'q' and k.isdigit():
                # id must be int string
                seen.add(k)
            else:
                seen.add(k)
        # id param appears once; if multiple same id -> error later
        if 'id' in seen and params['id'] != str(params['id']):
            # not integer? already ensured by k.isdigit
            pass
        # we will check repetition later via validation of id param
        # but just return params for now
        return params

    def parse_query(self):
        # get query string, decode
        qs = self.parse_qs(self.path)  # qs is dict of lists; but BaseHTTPRequestHandler parse_qs returns dict of list
        # we assume simple key=value, no duplicates, but we handle duplicates
        params = {}
        for k in qs:
            if k in ['title', 'author', 'isbn', 'synopsis', 'q']:
                # collect all values for this param if multiple (shouldn't happen per spec but be safe)
                vals = qs[k]
                # spec says multiple params together must all match; we treat as exact match
                params[k] = vals[0] if len(vals) == 1 else vals  # we'll just keep first; spec doesn't define multiple same param
            else:
                # id param may appear twice causing conflict; we'll treat as error later
                params[k] = qs[k][0]
        return params

    def do_POST(self):
        if not self.is_json():
            self.send_json_response(400, {"error": "Invalid JSON"})
            return

        content_len = int(self.headers.get('Content-Length', 0))
        if content_len == 0:
            self.send_json_response(400, {"error": "Empty body"})
            return

        try:
            payload = json.loads(self.rfile.read(content_len).decode())
        except Exception:
            self.send_json_response(400, {"error": "Invalid JSON"})
            return

        # validation
        required = ('title', 'author', 'isbn')
        for field in required:
            if field not in payload:
                self.send_json_response(400, {"error": f"missing required field {field}"} )
                return
            val = payload[field]
            if not isinstance(val, str) or not val.strip():
                self.send_json_response(400, {"error": f"field {field} is required and not empty"})
                return

        # id not supplied; assign new
        new_id = BookHandler.next_id
        BookHandler.next_id += 1

        book = {
            'id': new_id,
            'title': payload['title'].strip(),
            'author': payload['author'].strip(),
            'isbn': payload['isbn'].strip(),
            'synopsis': payload.get('synopsis', '').strip() if 'synopsis' in payload else ""
        }
        BookHandler.books.append(book)
        BookHandler.book_by_id[new_id] = book

        self.send_json_response(201, book)

    def do_GET(self):
        # Determine if path is /books or /books/{id}
        if self.path == '/books':
            # collect all books, apply filters
            query = self.parse_query()
            books = BookHandler.books[:]  # copy
            # apply filters
            filters = []
            if 'id' in query:
                id_val = query['id']
                # id must be integer string
                if not id_val.isdigit():
                    self.send_json_response(400, {"error": "unknown query parameter id"})
                    return
                id_int = int(id_val)
                books = [b for b in books if b['id'] == id_int]
            if 'title' in query:
                title_val = query['title'].lower()
                books = [b for b in books if b['title'].lower() == title_val]
            if 'author' in query:
                author_val = query['author'].lower()
                books = [b for b in books if b['author'].lower() == author_val]
            if 'isbn' in query:
                isbn_val = query['isbn'].lower()
                books = [b for b in books if b['isbn'].lower() == isbn_val]
            if 'synopsis' in query:
                synopsis_val = query['synopsis'].lower()
                books = [b for b in books if b['synopsis'].lower() == synopsis_val]
            if 'q' in query:
                q_val = query['q'].lower()
                # keep books where any of title, author, isbn, synopsis contains q_val ignoring case
                books = [b for b in books if any(q_val in field.lower() for field in [b['title'], b['author'], b['isbn'], b['synopsis']] )]
            # order by id
            books.sort(key=lambda b: b['id'])
            self.send_json_response(200, books)
            return

        # path is /books/{id}
        path_id = self.path.split('/')[-1]
        if not path_id.isdigit():
            self.send_json_response(404, {"error": "id not integer"})
            return
        book_id = int(path_id)
        book = BookHandler.book_by_id.get(book_id)
        if book is None:
            self.send_json_response(404, {"error": "book not found"})
            return
        self.send_json_response(200, book)

    def do_PUT(self):
        if self.path != '/books':
            self.send_json_response(404, {"error": "not found"})
            return
        if not self.is_json():
            self.send_json_response(400, {"error": "Invalid JSON"})
            return

        content_len = int(self.headers.get('Content-Length', 0))
        if content_len == 0:
            self.send_json_response(400, {"error": "Empty body"})
            return

        try:
            payload = json.loads(self.rfile.read(content_len).decode())
        except Exception:
            self.send_json_response(400, {"error": "Invalid JSON"})
            return

        # id supplied? It must be present and be the target id; spec says replace book's fields; id in body is ignored? For safety, require id in payload matches path id.
        if 'id' not in payload:
            self.send_json_response(400, {"error": "id in body is missing"})
            return
        # validate required fields
        required = ('title', 'author', 'isbn')
        for field in required:
            if field not in payload:
                self.send_json_response(400, {"error": f"missing required field {field}"} )
                return
            val = payload[field]
            if not isinstance(val, str) or not val.strip():
                self.send_json_response(400, {"error": f"field {field} is required and not empty"})
                return
            payload[field] = val.strip()

        # optional synopsis can be present; if present, ensure it's a string; default empty
        if 'synopsis' in payload:
            if not isinstance(payload['synopsis'], str):
                self.send_json_response(400, {"error": "synopsis must be a string"})
                return
            payload['synopsis'] = payload['synopsis'].strip()
        # id must be integer matching path? spec says id in body should be same as path; we'll just check path id matches payload id
        target_id = int(self.path.split('/')[-1])
        if payload['id'] != target_id:
            self.send_json_response(400, {"error": "id in body does not match path"} )
            return

        # update book
        book = BookHandler.book_by_id.get(target_id)
        if not book:
            self.send_json_response(404, {"error": "book not found"})
            return
        BookHandler.book_by_id[target_id] = {
            'id': target_id,
            'title': payload['title'],
            'author': payload['author'],
            'isbn': payload['isbn'],
            'synopsis': payload.get('synopsis', '')
        }
        self.send_json_response(200, BookHandler.book_by_id[target_id])

    def do_DELETE(self):
        if self.path != '/books':
            self.send_json_response(404, {"error": "not found"})
            return
        path_id = self.path.split('/')[-1]
        if not path_id.isdigit():
            self.send_json_response(400, {"error": "unknown query parameter id"})
            return
        book_id = int(path_id)
        if book_id not in BookHandler.book_by_id:
            self.send_json_response(404, {"error": "book not found"})
            return
        del BookHandler.book_by_id[book_id]
        self.send_json_response(204, None)

    def parse_qs(self):
        # use urllib.parse
        from urllib.parse import parse_qs
        import urllib.parse
        qs = urllib.parse.parse_qs(self.path, keep_blank_values=False)
        # for id param, we don't care about multiple values; we treat as error if >1 later
        return qs


def run_server():
    port = int(os.getenv('PORT', 8000))
    server = HTTPServer(('127.0.0.1', port), BookHandler)
    server.serve_forever()

if __name__ == '__main__':
    run_server()
