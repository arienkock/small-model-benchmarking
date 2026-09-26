import json
import os
import subprocess
import sys
import threading
import urllib.request
import urllib.error
from unittest import TestCase

class TestApp(TestCase):
    def test_S1_happy_create_book(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # wait for server
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        # POST /books
        data = json.dumps({
            "title": "1984",
            "author": "Orwell",
            "isbn": "123456"
        })
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books',
                                     data=data.encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 201)
            body = json.loads(resp.read())
            self.assertEqual(body['id'], 1)
            self.assertEqual(body['title'], "1984")
            self.assertEqual(body['author'], "Orwell")
            self.assertEqual(body['isbn'], "123456")
            self.assertEqual(body['synopsis'], "")
        proc.terminate()
        proc.wait()

    def test_S2_happy_get_book(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books/1',
                                     headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            body = json.loads(resp.read())
            self.assertEqual(body['id'], 1)
        proc.terminate()
        proc.wait()

    def test_S3_happy_update_book(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        data = json.dumps({
            "title": "Nineteen Eighty-Four",
            "author": "George Orwell",
            "isbn": "123456",
            "synopsis": "A dystopian novel"
        })
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books/1',
                                     method='PUT',
                                     data=data.encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            body = json.loads(resp.read())
            self.assertEqual(body['id'], 1)
            self.assertEqual(body['title'], "Nineteen Eighty-Four")
            self.assertEqual(body['author'], "George Orwell")
            self.assertEqual(body['isbn'], "123456")
            self.assertEqual(body['synopsis'], "A dystopian novel")
        proc.terminate()
        proc.wait()

    def test_S4_unhappy_missing_required_field(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        data = json.dumps({
            "title": "Test",
            "author": "Author",
            "isbn": ""
        })
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books',
                                     data=data.encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 400)
            err = json.loads(resp.read())
            self.assertIn("error", err)
            self.assertIn("isbn", err['error'])
        proc.terminate()
        proc.wait()

    def test_S5_unhappy_invalid_json_body(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        # send raw text, not JSON
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books',
                                     data=b'not json',
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 400)
            err = json.loads(resp.read())
            self.assertIn("error", err)
        proc.terminate()
        proc.wait()

    def test_S6_unhappy_unknown_query_param(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books?id=1', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books?id=1&unknown=foo',
                                     headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 400)
            err = json.loads(resp.read())
            self.assertIn("error", err)
            self.assertIn("unknown query parameter", err['error'])
        proc.terminate()
        proc.wait()

    def test_S7_unhappy_id_not_integer(self):
        port = 8000 + self.test_idx
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(10):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/books/abc', timeout=1)
                break
            except Exception:
                pass
        else:
            proc.terminate()
            raise RuntimeError('Server did not start')
        req = urllib.request.Request(f'http://127.0.0.1:{port}/books/abc',
                                     headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 404)
        proc.terminate()
        proc.wait()

# run with per-test-case index
def run(suite, name):
    class Dummy(TestCase):
        def __init__(self):
            self.test_idx = 0
        def setUp(self):
            self.test_idx = getattr(suite, f'{name}_idx', 0) + self.test_idx
    suite.addTest(Dummy(name))
    runner = unittest.TextTestRunner(verbosity=1)
    suite.addTests(suite)

if __name__ == '__main__':
    import unittest
    # Use run() to create Dummy instances with per-test indexing
    class Dummy(TestCase):
        def __init__(self):
            self.test_idx = 0
        def setUp(self):
            self.test_idx = getattr(suite, f'{self.__class__.__name__}_idx', 0) + self.test_idx
    
    loader = unittest.TestLoader()
    test_suite = loader.loadTestsFromTestCase(TestApp)
    for test in test_suite:
        dummy = Dummy()
        dummy.addTest(test)
    runner = unittest.TextTestRunner(verbosity=1)
    runner.run(test_suite)
