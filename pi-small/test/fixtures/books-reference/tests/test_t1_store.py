import unittest

from store import BookStore, ValidationError

BOOK = {"title": "Dune", "author": "Frank Herbert", "isbn": "9780441013593"}


class StoreTests(unittest.TestCase):
    def test_T1_S1_ids_increase_in_creation_order(self):
        store = BookStore()
        first = store.create(BOOK)
        second = store.create(BOOK)
        self.assertEqual((first["id"], second["id"]), (1, 2))

    def test_T1_S2_missing_title_is_rejected(self):
        with self.assertRaises(ValidationError):
            BookStore().create({"author": "A", "isbn": "1"})


if __name__ == "__main__":
    unittest.main()
