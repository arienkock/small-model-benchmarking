# Review (continued)

The code in /workspace was written for the task below. Do not change any files.

Review the code for completeness: is everything the task asks for there?

A previous session ran out of turns before it finished this review. Below is what it found so far. Continue the review, then report all of it in one call to the tool `submit_findings` — most important first, and including whatever below still holds.

## Findings so far

- [high] PUT path validation missing for non-integer IDs (app.py:do_PUT): int(self.path.split('/')[-1]) is called without try/except, so a non-integer path id raises ValueError instead of returning a proper error. Should validate and return 400.
- [high] GET /books q filter logic broken (app.py:do_GET_all): When field == 'q', the code does val in b[field].lower() where field is 'q', but book dicts have no 'q' key, causing a KeyError. The q filter should instead search across title/author/isbn/synopsis fields.
- [high] Type validation missing in POST and PUT (app.py:do_POST, do_PUT): Task requires 400 for 'field of wrong type', but POST and PUT only check for missing/empty required fields and id in body — they do not validate that fields are strings.
- [medium] GET /books id query param without type validation (app.py:do_GET_all): int(filters['id']) is called without try/except, so a non-integer id query param raises ValueError instead of returning 400.

## The task

Build a RESTful HTTP API for books in Python.

Constraints:
- Python 3 standard library only (for example http.server, json, urllib.parse, threading). No third-party packages.
- Keep the data in memory; nothing is written to disk. Data may be lost when the server stops.
- The entry point is `/workspace/app.py`. Running `python3 app.py` starts the server on the port given by the environment variable `PORT` (default 8000), listening on 127.0.0.1, and keeps serving until it is stopped.

A book has these fields:
- `id`: integer, assigned by the server (1, 2, 3, … in creation order, never reused after a delete); never supplied by the client
- `title`: string, required, not empty
- `author`: string, required, not empty
- `isbn`: string, required, not empty
- `synopsis`: string, optional; defaults to an empty string

Endpoints (all request and response bodies are JSON, with `Content-Type: application/json`):
- `POST /books` creates a book from a JSON object with title, author, isbn and optionally synopsis. Responds 201 with the created book, including its `id`.
- `GET /books/{id}` responds 200 with the book.
- `PUT /books/{id}` replaces the book's title, author, isbn and synopsis with the ones in the body (same rules as create). Responds 200 with the updated book.
- `DELETE /books/{id}` removes the book. Responds 204 with no body.
- `GET /books` responds 200 with a JSON list of all books, ordered by id. It supports searching and filtering by every field through query parameters:
  - `id=<n>` keeps only the book with that id;
  - `title=…`, `author=…`, `isbn=…`, `synopsis=…` keep books whose field contains the value, ignoring case;
  - `q=…` keeps books where any of title, author, isbn or synopsis contains the value, ignoring case;
  - several parameters together must all match. An unknown query parameter is an error.

Errors respond with a JSON object `{"error": "<message>"}`:
- 400 for a body that is not valid JSON or not a JSON object, a missing or empty required field, a field of the wrong type, an `id` in a create or update body, an id in the path that is not an integer, or an unknown query parameter;
- 404 for a book id that does not exist, or any other path.
