import json
import threading
import unittest
import urllib.error
import urllib.request

from app import create_server

BOOK = {"title": "Dune", "author": "Frank Herbert", "isbn": "9780441013593", "synopsis": "Desert."}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.server = create_server(0)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                text = r.read().decode()
                return r.status, json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode() or "null")

    def test_S1_create_returns_201_with_id(self):
        status, book = self.call("POST", "/books", BOOK)
        self.assertEqual(status, 201)
        self.assertEqual(book, {**BOOK, "id": 1})

    def test_S2_get_by_id(self):
        self.call("POST", "/books", BOOK)
        self.assertEqual(self.call("GET", "/books/1"), (200, {**BOOK, "id": 1}))

    def test_S3_filter_by_author(self):
        self.call("POST", "/books", BOOK)
        self.call("POST", "/books", {"title": "Emma", "author": "Jane Austen", "isbn": "2"})
        status, books = self.call("GET", "/books?author=austen")
        self.assertEqual((status, [b["title"] for b in books]), (200, ["Emma"]))

    def test_S4_update_replaces_fields(self):
        self.call("POST", "/books", BOOK)
        status, book = self.call("PUT", "/books/1", {**BOOK, "title": "Dune Messiah"})
        self.assertEqual((status, book["title"]), (200, "Dune Messiah"))

    def test_S5_delete_removes_book(self):
        self.call("POST", "/books", BOOK)
        self.assertEqual(self.call("DELETE", "/books/1"), (204, None))
        self.assertEqual(self.call("GET", "/books/1")[0], 404)

    def test_S6_create_without_title_is_400(self):
        status, body = self.call("POST", "/books", {"author": "A", "isbn": "1"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_S7_unknown_id_is_404(self):
        self.assertEqual(self.call("GET", "/books/99")[0], 404)

    def test_S8_unknown_query_parameter_is_400(self):
        self.assertEqual(self.call("GET", "/books?colour=red")[0], 400)

    def test_T2_S1_post_then_list(self):
        self.call("POST", "/books", BOOK)
        status, books = self.call("GET", "/books")
        self.assertEqual((status, len(books)), (200, 1))

    def test_T2_S2_invalid_json_is_400(self):
        self.assertEqual(self.call("POST", "/books", raw=b"{nope")[0], 400)


if __name__ == "__main__":
    unittest.main()
