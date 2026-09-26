import unittest
import subprocess
import time
import urllib.request
import urllib.error
import json
import os

class TestT1(unittest.TestCase):
    def setUp(self):
        self.port = 8888
        self.proc = subprocess.Popen([
            'python3', '/workspace/app.py'],
            env={**os.environ, 'PORT': str(self.port)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE)
        # wait a bit for server start
        time.sleep(1)

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait()

    def make_request(self, method, path, data=None):
        if method == 'POST':
            req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}',
                                         data=json.dumps(data).encode(),
                                         headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req) as resp:
                    return resp.status, resp.read(), resp.getheaders()
            except urllib.error.HTTPError as e:
                return e.code, e.read().decode(), e.headers
        else:  # GET
            req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}',
                                         headers={'Accept': 'application/json'})
            try:
                with urllib.request.urlopen(req) as resp:
                    return resp.status, resp.read(), resp.getheaders()
            except urllib.error.HTTPError as e:
                return e.code, e.read().decode(), e.headers

    def test_T1_S1_create_book(self):
        status, body, _ = self.make_request('POST', '/books',
                                          {"title": "1984", "author": "Orwell", "isbn": "123456"})
        self.assertEqual(status, 201)
        data = json.loads(body)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], "1984")
        self.assertEqual(data['author'], "Orwell")
        self.assertEqual(data['isbn'], "123456")
        self.assertEqual(data['synopsis'], "")

    def test_T1_S2_get_book(self):
        status, body, _ = self.make_request('GET', f'/books/{1}')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data['id'], 1)
        self.assertEqual(data['title'], "1984")

    def test_T1_S3_update_book(self):
        # first ensure book exists
        status, body, _ = self.make_request('GET', '/books/1')
        self.assertEqual(status, 200)
        # update
        status, body, _ = self.make_request('PUT', '/books/1',
                                          {"title": "Nineteen Eighty-Four",
                                           "author": "George Orwell",
                                           "isbn": "123456",
                                           "synopsis": "A dystopian novel"})
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data['title'], "Nineteen Eighty-Four")
        self.assertEqual(data['author'], "George Orwell")
        self.assertEqual(data['isbn'], "123456")
        self.assertEqual(data['synopsis'], "A dystopian novel")

    def test_T1_S4_missing_required_field(self):
        status, body, _ = self.make_request('POST', '/books',
                                          {"title": "Test", "author": "Author", "isbn": ""})
        self.assertEqual(status, 400)
        err = json.loads(body)
        self.assertIn("error", err)
        self.assertEqual(err["error"], "isbn is empty")

    def test_T1_S5_invalid_json_body(self):
        # POST with non-JSON body
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}/books',
                                     data=b'not json',
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as resp:
                self.fail("Expected 400")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            err = json.loads(e.read().decode())
            self.assertEqual(err["error"], "invalid JSON")

    def test_T1_S6_unknown_query_param(self):
        status, body, _ = self.make_request('GET', '/books?id=1&unknown=foo')
        self.assertEqual(status, 400)
        err = json.loads(body)
        self.assertEqual(err["error"], "unknown query parameter")

    def test_T1_S7_id_not_integer(self):
        status, body, _ = self.make_request('GET', '/books/abc')
        self.assertEqual(status, 404)
        err = json.loads(body)
        self.assertEqual(err["error"], "not found")

if __name__ == '__main__':
    unittest.main()
