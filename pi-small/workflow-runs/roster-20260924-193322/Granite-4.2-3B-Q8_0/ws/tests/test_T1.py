import unittest
import json
import urllib.request
import urllib.error
import threading
import time
import socket
from http.server import ThreadingHTTPServer
from app import BookHandler

def start_server(port):
    """Start server on given port and return thread handle."""
    def serve():
        server = ThreadingHTTPServer(('127.0.0.1', port), BookHandler)
        server.serve_forever()
    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    time.sleep(0.5)

class TestT1(unittest.TestCase):
    BASE_PORT = None

    def setUp(self):
        # reset in-memory state
        BookHandler.books = []
        BookHandler.next_id = 1
        # find a free port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.BASE_PORT = self.port
        start_server(self.BASE_PORT)

    def tearDown(self):
        BookHandler.books = []
        BookHandler.next_id = 1

    def _make_request(self, method, path, data=None, headers=None):
        url = f"http://127.0.0.1:{self.BASE_PORT}{path}"
        req = urllib.request.Request(url, data=data, method=method)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        try:
            resp = urllib.request.urlopen(req)
            return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode().strip()
        except Exception:
            return None, None

    def test_T1_S1_happy_create_book(self):
        """POST /books with required fields -> 201, book id 1"""
        status, body = self._make_request('POST', '/books',
                                       json.dumps({"title": "Test",
                                                   "author": "Author",
                                                   "isbn": "12345"}))
        self.assertEqual(status, 201)
        book = json.loads(body)
        self.assertEqual(book['id'], 1)
        self.assertEqual(book['title'], "Test")
        self.assertEqual(book['author'], "Author")
        self.assertEqual(book['isbn'], "12345")
        self.assertEqual(book['synopsis'], "")

    def test_T1_S2_happy_get_book(self):
        """GET /books/1 -> 200 with book"""
        status, body = self._make_request('GET', '/books/1')
        self.assertEqual(status, 200)
        book = json.loads(body)
        self.assertEqual(book['id'], 1)
        self.assertEqual(book['title'], "Test")
        self.assertEqual(book['author'], "Author")
        self.assertEqual(book['isbn'], "12345")
        self.assertEqual(book['synopsis'], "")

    def test_T1_S3_happy_update_book(self):
        """PUT /books/1 with new fields -> 200 updated book"""
        status, body = self._make_request('PUT', '/books/1',
                                       json.dumps({"title": "New",
                                                   "author": "Author2",
                                                   "isbn": "99999",
                                                   "synopsis": "desc"}))
        self.assertEqual(status, 200)
        book = json.loads(body)
        self.assertEqual(book['id'], 1)
        self.assertEqual(book['title'], "New")
        self.assertEqual(book['author'], "Author2")
        self.assertEqual(book['isbn'], "99999")
        self.assertEqual(book['synopsis'], "desc")

    def test_T1_S4_unhappy_missing_required_field(self):
        """POST missing required field -> 400 with missing field error"""
        # missing title
        status, body = self._make_request('POST', '/books',
                                       json.dumps({"author": "Author",
                                                   "isbn": "12345"}))
        self.assertEqual(status, 400)
        err = json.loads(body)
        self.assertIn("error", err)
        self.assertIn("Missing required field", err['error'].lower())
