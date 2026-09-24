import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.port = free_port()
        self.proc = subprocess.Popen([sys.executable, "app.py"], cwd=HERE, env={**os.environ, "PORT": str(self.port)})
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    def tearDown(self):
        self.proc.kill()
        self.proc.wait()

    def test_I2_create_and_search_through_the_real_server(self):
        base = f"http://127.0.0.1:{self.port}"
        req = urllib.request.Request(base + "/books", data=json.dumps({"title": "Emma", "author": "Jane Austen", "isbn": "1"}).encode(), method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(r.status, 201)
        with urllib.request.urlopen(base + "/books?q=austen", timeout=5) as r:
            self.assertEqual([b["title"] for b in json.loads(r.read())], ["Emma"])


if __name__ == "__main__":
    unittest.main()
