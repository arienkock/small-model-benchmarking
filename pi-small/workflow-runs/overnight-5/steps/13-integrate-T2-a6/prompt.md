# Workflow step: integrate T2

Task T2 is implemented and its tests pass. Now write integration tests that exercise T2 together with the earlier tasks (T1) through the real entry points of the finished program, the way a user of it would, rather than by calling its internals. If an integration test finds a bug, fix the code.

Rules:
- Work in /workspace.
- Every scenario needs an automated test that proves it. Tests go in files matching `tests/*.py`.
- The harness runs the whole test suite from /workspace with: `python3 -m unittest discover -s tests -v`. It must pass and finish within 60 seconds; run it yourself before you finish, with the bash tool's timeout set to 60.
- Tests must clean up whatever they start (servers, background processes, temporary files).

## The task

Build a RESTful HTTP API for books in Python.

Constraints:
- Python 3 standard library only (for example http.server, json, urllib.parse, threading). No third-party packages.
- Keep the data in memory; nothing is written to disk. Data may be lost when the server stops.
- The entry point is `/workspace/app.py`. Running `python3 app.py` starts the server on the port given by the environment variable `PORT` (default 8000), listening on 127.0.0.1, and keeps serving until it is stopped.

A book has these fields:
- `id`: integer, assigned by the server (1, 2, 3, â€¦ in creation order, never reused after a delete); never supplied by the client
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
  - `title=â€¦`, `author=â€¦`, `isbn=â€¦`, `synopsis=â€¦` keep books whose field contains the value, ignoring case;
  - `q=â€¦` keeps books where any of title, author, isbn or synopsis contains the value, ignoring case;
  - several parameters together must all match. An unknown query parameter is an error.

Errors respond with a JSON object `{"error": "<message>"}`:
- 400 for a body that is not valid JSON or not a JSON object, a missing or empty required field, a field of the wrong type, an `id` in a create or update body, an id in the path that is not an integer, or an unknown query parameter;
- 404 for a book id that does not exist, or any other path.

## Current task: T2 — Implement book storage and CRUD logic

CRUD operations work for individual books, validation, ID assignment

Files: app.py

Scenarios to test:
- **S1** [happy] create_book — Given empty in-memory store; when POST /books with JSON {"title": "1984", "author": "Orwell", "isbn": "123456"}; then 201 with {"id": 1, "title": "1984", "author": "Orwell", "isbn": "123456", "synopsis": ""}
- **S2** [happy] get_book — Given book id 1 exists; when GET /books/1; then 200 with the book object
- **S3** [happy] update_book — Given book id 1 exists; when PUT /books/1 with JSON {"title": "Nineteen Eighty-Four", "author": "George Orwell", "isbn": "123456", "synopsis": "A dystopian novel"}; then 200 with updated book
- **S8** [happy] delete_book — Given book id 1 exists; when DELETE /books/1; then 204 with no body
- **S10** [unhappy] duplicate_id_in_create — Given book id 1 already exists; when POST /books with same fields as book 1; then 400 with error "id" already used?

Implementation logic:
- store books in dict keyed by id, assign sequential ids, validate required fields non-empty, reject empty/missing fields; on POST create new id, reject duplicate id; on GET/PUT/DELETE retrieve/modify/delete; return appropriate HTTP status and JSON

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py.
- app.py defines make_server(port), which returns an http.server.HTTPServer (or ThreadingHTTPServer) bound to 127.0.0.1:port; `python3 app.py` calls it with $PORT and serves forever.
- Tests call app.make_server(0) in setUpClass (port 0 picks a free port; the real one is server.server_address[1]), run serve_forever() in a daemon thread, and call shutdown() and then server_close() in tearDownClass.

When the whole suite passes, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.

## A previous attempt at this step failed

The harness checks did NOT pass:
- 9 tests ran, but there are 10 scenarios so far: write a test for each one.

The files from an earlier attempt are in /workspace; continue from them.
