import unittest
import json
import urllib.request
import urllib.error
import threading
import time
from app import make_server

class TestT1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.daemon = True
        cls.thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def _request(self, method, path, json_body=None):
        """Return (status, body) where body is JSON or error dict."""
        if json_body is None:
            req = urllib.request.Request(
                f'http://127.0.0.1:{self.port}{path}',
                method=method
            )
        else:
            data = json.dumps(json_body).encode()
            req = urllib.request.Request(
                f'http://127.0.0.1:{self.port}{path}',
                data=data,
                method=method,
                headers={'Content-Type': 'application/json'}
            )
        try:
            resp = urllib.request.urlopen(req)
            return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return None, None

    def test_S1_create_book(self):
        status, body = self._request('POST', '/books',
            {"title": "1984", "author": "Orwell", "isbn": "123456"})
        self.assertEqual(status, 201)
        expected = {"id": 1, "title": "1984", "author": "Orwell", "isbn": "123456", "synopsis": ""}
        self.assertEqual(body, expected)

    def test_S2_get_book(self):
        status, body = self._request('GET', '/books/1')
        self.assertEqual(status, 200)
        self.assertEqual(body['id'], 1)
        self.assertEqual(body['title'], "1984")

    def test_S3_update_book(self):
        self._request('PUT', '/books/1',
            {"title": "Nineteen Eighty-Four",
             "author": "George Orwell",
             "isbn": "123456",
             "synopsis": "A dystopian novel"})
        status, body = self._request('GET', '/books/1')
        self.assertEqual(status, 200)
        self.assertEqual(body['title'], "Nineteen Eighty-Four")
        self.assertEqual(body['author'], "George Orwell")
        self.assertEqual(body['synopsis'], "A dystopian novel")

    def test_S4_missing_required_field(self):
        status, body = self._request('POST', '/books',
            {"title": "Test", "author": "Author", "isbn": ""})
        self.assertEqual(status, 400)
        self.assertIn('error', body)

    def test_S5_invalid_json_body(self):
        req = urllib.request.Request(
            f'http://127.0.0.1:{self.port}/books',
            data=b'not json',
            method='POST',
            headers={'Content-Type': 'application/json'}
        )
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            status = e.code
            body = json.loads(e.read().decode())
        else:
            status = -1
            body = {}
        self.assertEqual(status, 400)
        self.assertIn('error', body)

    def test_S6_unknown_query_param(self):
        req = urllib.request.Request(
            f'http://127.0.0.1:{self.port}/books?id=1&unknown=foo',
            method='GET'
        )
        req.add_header('Content-Type', 'application/json')
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            status = e.code
            body = json.loads(e.read().decode())
        else:
            status = -1
            body = {}
        self.assertEqual(status, 400)
        self.assertIn('unknown query parameter', body['error'].lower())

    def test_S7_id_not_integer(self):
        status, body = self._request('GET', '/books/abc')
        self.assertEqual(status, 404)

if __name__ == '__main__':
    unittest.main()
