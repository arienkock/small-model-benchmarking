import unittest
import threading
import time
import urllib.request
import urllib.error
import json
from http.server import HTTPServer
from app import BookHandler

class TestT2(unittest.TestCase):
    def setUp(self):
        self.port = 9000
        self.server = HTTPServer(('127.0.0.1', self.port), BookHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        time.sleep(0.1)

    def tearDown(self):
        self.server.shutdown()
        self.server_thread.join(timeout=1)

    def make_request(self, method, path, json_body=None):
        url = f'http://127.0.0.1:{self.port}{path}'
        req_data = None
        if json_body is not None:
            body = json.dumps(json_body).encode()
            req = urllib.request.Request(url, data=body, method=method,
                                         headers={'Content-Type': 'application/json'})
        else:
            req = urllib.request.Request(url, method=method)
        try:
            resp = urllib.request.urlopen(req)
            return resp.code, resp.read().decode(), None
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), None
        except Exception as e:
            return None, str(e), None

    def test_T2_S1(self):
        # create book
        code, body, err = self.make_request('POST', '/books',
            {
                'title': 'Python',
                'author': 'Doe',
                'isbn': '123456'
            })
        self.assertEqual(code, 201)
        data = json.loads(body)
        self.assertEqual(data['id'], 1)
        # get
        code, body, err = self.make_request('GET', '/books/1')
        self.assertEqual(code, 200)
        book = json.loads(body)
        self.assertEqual(book['id'], 1)
        self.assertEqual(book['title'], 'Python')
        self.assertEqual(book['author'], 'Doe')
        self.assertEqual(book['isbn'], '123456')
        self.assertEqual(book['synopsis'], '')

    def test_T2_S2(self):
        # update book
        code, body, err = self.make_request('POST', '/books',
            {
                'title': 'Python',
                'author': 'Doe',
                'isbn': '123456'
            })
        self.assertEqual(code, 201)

        code, body, err = self.make_request('PUT', '/books/1',
            {
                'title': 'Python Programming',
                'author': 'Smith',
                'isbn': '123456',
                'synopsis': 'A guide'
            })
        self.assertEqual(code, 200)
        data = json.loads(body)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], 'Python Programming')
        self.assertEqual(data['author'], 'Smith')
        self.assertEqual(data['isbn'], '123456')
        self.assertEqual(data['synopsis'], 'A guide')

    def test_T2_S3(self):
        # delete book
        code, body, err = self.make_request('POST', '/books',
            {
                'title': 'Python',
                'author': 'Doe',
                'isbn': '123456'
            })
        self.assertEqual(code, 201)

        code, body, err = self.make_request('DELETE', '/books/1')
        self.assertEqual(code, 204)

        code, body, err = self.make_request('GET', '/books/1')
        self.assertEqual(code, 404)

    def test_T2_S4(self):
        # missing required field
        code, body, err = self.make_request('POST', '/books',
            {
                'title': 'Test',
                'author': 'Author'
            })
        self.assertEqual(code, 400)
        data = json.loads(body)
        self.assertEqual(data['error'], 'missing required field isbn')

    def test_T2_S7(self):
        # non-integer id in path -> 404
        code, body, err = self.make_request('GET', '/books/abc')
        self.assertEqual(code, 404)

    def test_T2_S8(self):
        # unknown query param
        code, body, err = self.make_request('GET', '/books?id=1&invalid=foo')
        self.assertEqual(code, 400)
        data = json.loads(body)
        self.assertEqual(data['error'], 'unknown query parameter invalid')

    def test_T2_S9(self):
        # search by id
        code, body, err = self.make_request('GET', '/books?id=1')
        self.assertEqual(code, 200)
        books = json.loads(body)
        self.assertEqual(len(books), 1)
        self.assertEqual(books[0]['id'], 1)
        self.assertEqual(books[0]['title'], 'Python')
        self.assertEqual(books[0]['author'], 'Doe')
        self.assertEqual(books[0]['isbn'], '123456')

    def test_T2_S10(self):
        # filter by title contains 'python' (case-insensitive)
        code, body, err = self.make_request('GET', '/books?title=python')
        self.assertEqual(code, 200)
        books = json.loads(body)
        self.assertEqual(len(books), 1)
        self.assertEqual(books[0]['id'], 1)

    def test_T2_S11(self):
        # repeated id param -> error
        code, body, err = self.make_request('GET', '/books?id=1&id=2')
        self.assertEqual(code, 400)
        data = json.loads(body)
        self.assertEqual(data['error'], 'unknown query parameter id')

    def test_T2_S12(self):
        # conflicting filters id and title nonexistent -> 404
        code, body, err = self.make_request('POST', '/books',
            {
                'title': 'Python',
                'author': 'Doe',
                'isbn': '123456'
            })
        self.assertEqual(code, 201)
        code, body, err = self.make_request('GET', '/books?id=1&title=nonexistent')
        self.assertEqual(code, 404)

if __name__ == '__main__':
    unittest.main()
