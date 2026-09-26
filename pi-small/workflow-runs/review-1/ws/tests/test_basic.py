import unittest
import json
import threading
import time
import http.client
from app import make_server


class TestBasic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 0
        cls.server = make_server(cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.daemon = True
        cls.thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def _request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        conn.close()
        return resp

    def test_create_book(self):
        data = {"title": "1984", "author": "Orwell", "isbn": "123456"}
        resp = self._request('POST', '/books', body=json.dumps(data),
                            headers={'Content-Type': 'application/json'})
        self.assertEqual(resp.status, 201)
        body = json.loads(resp.read())
        self.assertEqual(body['id'], 1)
        self.assertEqual(body['title'], "1984")
        self.assertEqual(body['author'], "Orwell")
        self.assertEqual(body['isbn'], "123456")

    def test_get_book(self):
        resp = self._request('GET', '/books/1')
        self.assertEqual(resp.status, 200)
        body = json.loads(resp.read())
        self.assertEqual(body['id'], 1)
        self.assertEqual(body['title'], "1984")

    def test_update_book(self):
        data = {"title": "Nineteen Eighty-Four", "author": "George Orwell",
                "isbn": "123456", "synopsis": "A dystopian novel"}
        resp = self._request('PUT', '/books/1', body=json.dumps(data),
                            headers={'Content-Type': 'application/json'})
        self.assertEqual(resp.status, 200)
        body = json.loads(resp.read())
        self.assertEqual(body['title'], "Nineteen Eighty-Four")
        self.assertEqual(body['author'], "George Orwell")
        self.assertEqual(body['isbn'], "123456")
        self.assertEqual(body['synopsis'], "A dystopian novel")

    def test_missing_required_field(self):
        data = {"title": "Test", "author": "Author", "isbn": ""}
        resp = self._request('POST', '/books', body=json.dumps(data),
                            headers={'Content-Type': 'application/json'})
        self.assertEqual(resp.status, 400)
        err = json.loads(resp.read())
        self.assertIn("error", err)
        self.assertIn("isbn", err["error"].lower())

    def test_invalid_json_body(self):
        resp = self._request('POST', '/books', body='not json',
                            headers={'Content-Type': 'application/json'})
        self.assertEqual(resp.status, 400)
        err = json.loads(resp.read())
        self.assertIn("error", err)

    def test_unknown_query_param(self):
        resp = self._request('GET', '/books?id=1&unknown=foo')
        self.assertEqual(resp.status, 400)
        err = json.loads(resp.read())
        self.assertIn("error", err)
        self.assertIn("unknown", err["error"].lower())

    def test_id_not_integer(self):
        resp = self._request('GET', '/books/abc')
        self.assertEqual(resp.status, 404)
