import json
import urllib.request
import urllib.error
import unittest
import os
from app import Handler
from http.server import ThreadingHTTPServer
import socket


class TestS7(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.server_close()

    def test_S7_wrong_type(self):
        req = urllib.request.Request("http://127.0.0.1:" + str(self.port) + "/books", data=json.dumps({"title": 123, "author": "Test", "isbn": "000"}).encode(), headers={"Content-Type": "application/json"})
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            data = json.loads(e.read())
            self.assertEqual(data["error"], "title must be a string")
            return
        self.assertEqual(resp.status, 400)
        data = json.loads(resp.read())
        self.assertEqual(data["error"], "title must be a string")
