import json
import subprocess
import sys
import os
import socket
import time
import urllib.request
import urllib.error
import unittest

class T1Test(unittest.TestCase):
    def run_server(self, port):
        env = os.environ.copy()
        env['PORT'] = str(port)
        proc = subprocess.Popen([sys.executable, '/workspace/app.py'],
                               env=env,
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL)
        # small delay for server start
        time.sleep(1)
        return proc, port

    def test_T1_S1(self):
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()

        proc, p = self.run_server(port)

        url = f'http://127.0.0.1:{port}/books'

        for attempt in range(5):
            try:
                req = urllib.request.Request(
                    url,
                    data=json.dumps({
                        "title": "Python",
                        "author": "Doe",
                        "isbn": "123456"
                    }).encode(),
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                resp = urllib.request.urlopen(req, timeout=5)
                if resp.status == 201:
                    body = json.loads(resp.read())
                    self.assertEqual(body['id'], 1)
                    self.assertEqual(body['title'], "Python")
                    self.assertEqual(body['author'], "Doe")
                    self.assertEqual(body['isbn'], "123456")
                    proc.terminate()
                    proc.wait()
                    return
                else:
                    raise AssertionError(f"Expected 201, got {resp.status}")
            except urllib.error.HTTPError as e:
                if e.code == 400 and "missing required field isbn" not in str(e):
                    raise AssertionError(f"Unexpected error: {e}")
                if e.code == 201:
                    # Should have succeeded, maybe we got other error
                    # parse body? but proceed anyway
                    body = json.loads(e.read())
                    self.assertEqual(body['id'], 1)
                    proc.terminate()
                    proc.wait()
                    return
                time.sleep(1 * attempt)  # increasing backoff
            except Exception as e:
                time.sleep(1 * attempt)
        proc.terminate()
        proc.wait()
        self.fail("S1 test failed")

    def test_T1_S2(self):
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()

        proc, p = self.run_server(port)
        url = f'http://127.0.0.1:{port}/books'

        for attempt in range(5):
            try:
                req = urllib.request.Request(
                    url,
                    data=json.dumps({
                        "title": "Test",
                        "author": "Author"
                    }).encode(),
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                resp = urllib.request.urlopen(req, timeout=5)
                # should be 400
                self.fail(f"Expected 400, got {resp.status}")
            except urllib.error.HTTPError as e:
                if e.code == 400:
                    body = json.loads(e.read())
                    self.assertEqual(body.get('error'), "missing required field isbn")
                    proc.terminate()
                    proc.wait()
                    return
                raise AssertionError(f"Unexpected HTTP error: {e}")
            except Exception as e:
                time.sleep(1 * attempt)
        proc.terminate()
        proc.wait()
        self.fail("S2 test failed")

if __name__ == '__main__':
    unittest.main()
