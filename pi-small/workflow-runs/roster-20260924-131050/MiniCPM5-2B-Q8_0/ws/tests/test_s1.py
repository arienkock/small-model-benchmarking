import json
import urllib.request
import urllib.error
import unittest
import os
from app import Handler
from http.server import ThreadingHTTPServer
import socket


class TestS1(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.server_close()

    def test_S1_happy_create(self):
        req = urllib.request.Request("http://127.0.0.1:" + str(self.port) + "/books", data=json.dumps({"title": "Test Book", "author": "Test Author", "isbn": "000"}).encode(), headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req)
        self.assertEqual(resp.status, 201)
        data = json.loads(resp.read())
        self.assertEqual(data["title"], "Test Book")
        self.assertEqual(data["author"], "Test Author")
        self.assertEqual(data["isbn"], "000")
        self.assertEqual(data["id"], 1)
