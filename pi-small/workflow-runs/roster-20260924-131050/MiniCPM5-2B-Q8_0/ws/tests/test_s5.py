import json
import urllib.request
import urllib.error
import unittest
import os
from app import Handler
from http.server import ThreadingHTTPServer
import socket


class TestS5(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.server_close()


    def test_S5_invalid_json(self):
        req = urllib.request.Request("http://127.0.0.1:" + str(self.port) + "/books", data=b"not json", headers={"Content-Type": "application/json"})
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            data = json.loads(e.read())
            self.assertEqual(data["error"], "Invalid JSON")
            return
        self.assertEqual(resp.status, 400)
        data = json.loads(resp.read())
        self.assertEqual(data["error"], "Invalid JSON")
