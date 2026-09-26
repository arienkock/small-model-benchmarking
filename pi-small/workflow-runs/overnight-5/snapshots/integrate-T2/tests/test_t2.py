import unittest
import json
import threading
import time
import http.client
from app import make_server


class TestT2(unittest.TestCase):
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

    def test_delete_book(self):
        resp = self._request('DELETE', '/books/1')
        self.assertEqual(resp.status, 204)
        # DELETE should have no body
        body = resp.read()
        self.assertEqual(body, b'')

    def test_duplicate_id_in_create(self):
        # Book id 1 exists
        self._request('POST', '/books', body=json.dumps({"title": "1984", "author": "Orwell", "isbn": "123456"}),
                      headers={'Content-Type': 'application/json'})
        data = {"title": "1984", "author": "Orwell", "isbn": "123456", "id": 1}
        resp = self._request('POST', '/books', body=json.dumps(data),
                             headers={'Content-Type': 'application/json'})
        self.assertEqual(resp.status, 400)
        err = json.loads(resp.read())
        self.assertIn("error", err)
        self.assertIn("id", err["error"].lower())
