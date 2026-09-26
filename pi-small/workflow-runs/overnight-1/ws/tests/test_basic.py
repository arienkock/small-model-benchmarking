import json
import os
import unittest
import http.client
import threading
import time

from app import BookHandler, run


class TestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 18081

    @classmethod
    def tearDownClass(cls):
        pass

    def _start_server(self):
        BookHandler.books = []
        BookHandler.next_id = 1
        httpd = run(self.port)
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = True
        thread.start()
        self.timeout = 5
        for _ in range(50):
            try:
                conn = http.client.HTTPConnection('127.0.0.1', self.port)
                conn.close()
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("Server did not start")

    def _stop_server(self):
        # noop for test cleanup

    def _get(self, path):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request("GET", path)
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        return resp.status, data


class TestT1_S1(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_create_book(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        body = json.dumps({"title": "1984", "author": "Orwell", "isbn": "123456"})
        conn.request("POST", "/books", body, {"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 201)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], "1984")
        self.assertEqual(data['author'], "Orwell")
        self.assertEqual(data['isbn'], "123456")
        self.assertEqual(data['synopsis'], "")


class TestT1_S2(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_get_book(self):
        status, data = self._get("/books/1")
        self.assertEqual(status, 200)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], "1984")


class TestT1_S3(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_update_book(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        body = json.dumps({"title": "Nineteen Eighty-Four", "author": "George Orwell", "isbn": "123456", "synopsis": "A dystopian novel"})
        conn.request("PUT", "/books/1", body, {"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], "Nineteen Eighty-Four")
        self.assertEqual(data['author'], "George Orwell")
        self.assertEqual(data['isbn'], "123456")
        self.assertEqual(data['synopsis'], "A dystopian novel")


class TestT1_S4(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_missing_required_field(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        body = json.dumps({"title": "Test", "author": "Author", "isbn": ""})
        conn.request("POST", "/books", body, {"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 400)
        self.assertEqual(data['error'], "isbn is empty")


class TestT1_S5(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_invalid_json_body(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request("POST", "/books", "this is not json", {"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 400)
        self.assertEqual(data['error'], 'invalid JSON')


class TestT1_S6(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_unknown_query_param(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request("GET", "/books?id=1&unknown=foo")
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 400)
        self.assertEqual(data['error'], 'unknown query parameter')


class TestT1_S7(TestBase):
    def setUp(self):
        self._start_server()

    def tearDown(self):
        self._stop_server()

    def test_id_not_integer(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request("GET", "/books/abc")
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        conn.close()
        self.assertEqual(resp.status, 404)
        self.assertEqual(data['error'], 'Not Found')
