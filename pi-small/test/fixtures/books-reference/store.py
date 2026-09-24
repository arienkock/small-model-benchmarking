"""In-memory book store: validation, ids, search. No HTTP here."""
import threading

FIELDS = ("title", "author", "isbn", "synopsis")
REQUIRED = ("title", "author", "isbn")


class ValidationError(ValueError):
    pass


def validate(data):
    if not isinstance(data, dict):
        raise ValidationError("body must be a JSON object")
    if "id" in data:
        raise ValidationError("id is assigned by the server")
    book = {}
    for field in REQUIRED:
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValidationError(f"{field} is required and must be a non-empty string")
        book[field] = value
    synopsis = data.get("synopsis", "")
    if not isinstance(synopsis, str):
        raise ValidationError("synopsis must be a string")
    book["synopsis"] = synopsis
    return book


class BookStore:
    def __init__(self):
        self._books = {}
        self._next_id = 1
        self._lock = threading.Lock()

    def create(self, data):
        fields = validate(data)
        with self._lock:
            book = {"id": self._next_id, **fields}
            self._books[self._next_id] = book
            self._next_id += 1
            return dict(book)

    def get(self, book_id):
        book = self._books.get(book_id)
        return dict(book) if book else None

    def update(self, book_id, data):
        fields = validate(data)
        with self._lock:
            if book_id not in self._books:
                return None
            self._books[book_id] = {"id": book_id, **fields}
            return dict(self._books[book_id])

    def delete(self, book_id):
        with self._lock:
            return self._books.pop(book_id, None) is not None

    def search(self, filters):
        result = []
        for book in sorted(self._books.values(), key=lambda b: b["id"]):
            if all(self._matches(book, key, value) for key, value in filters.items()):
                result.append(dict(book))
        return result

    @staticmethod
    def _matches(book, key, value):
        if key == "id":
            return book["id"] == value
        if key == "q":
            return any(value.lower() in book[f].lower() for f in FIELDS)
        return value.lower() in book[key].lower()
