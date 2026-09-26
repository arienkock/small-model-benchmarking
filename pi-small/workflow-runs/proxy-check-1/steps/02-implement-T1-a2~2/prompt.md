# Workflow step: implement T1

Implement task T1 (described at the end), together with a test for every scenario listed for it. Earlier tasks are already done and verified; keep their tests passing.

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

## Current task: T1 — Create basic server and routing

Server starts and handles simple routes; basic request/response structure

Files: app.py

Scenarios to test:
- **S1** [happy] create_book — Given empty in-memory store; when POST /books with JSON {"title": "1984", "author": "Orwell", "isbn": "123456"}; then 201 with {"id": 1, "title": "1984", "author": "Orwell", "isbn": "123456", "synopsis": ""}
- **S2** [happy] get_book — Given book id 1 exists; when GET /books/1; then 200 with the book object
- **S3** [happy] update_book — Given book id 1 exists; when PUT /books/1 with JSON {"title": "Nineteen Eighty-Four", "author": "George Orwell", "isbn": "123456", "synopsis": "A dystopian novel"}; then 200 with updated book
- **S4** [unhappy] missing_required_field — Given POST /books with JSON {"title": "Test", "author": "Author", "isbn": ""}; when send request; then 400 with error "isbn" is empty
- **S5** [unhappy] invalid_json_body — Given POST /books with non-JSON body; when send request with raw text; then 400 with error "error" (invalid JSON)
- **S6** [unhappy] unknown_query_param — Given GET /books with query ?id=1&unknown=foo; when make request; then 400 with error "unknown query parameter"
- **S7** [unhappy] id_not_integer — Given GET /books/abc; when request; then 404

Implementation logic:
- use http.server or simple http.server module to start basic HTTP server on given PORT; parse request line and JSON; handle POST /books, GET /books/{id} simple routes; store books in list dict with id auto-increment; validate minimal required fields for create; return appropriate status codes and JSON responses

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py.
- app.py defines make_server(port), which returns an http.server.HTTPServer (or ThreadingHTTPServer) bound to 127.0.0.1:port; `python3 app.py` calls it with $PORT and serves forever.
- Tests call app.make_server(0) in setUpClass (port 0 picks a free port; the real one is server.server_address[1]), run serve_forever() in a daemon thread, and call shutdown() and then server_close() in tearDownClass.

When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.

## A previous attempt at this step failed

The harness checks did NOT pass:
- the test suite failed (`python3 -m unittest discover -s tests -v` exited 1).

Failing tests:
- test_S3_update_book: json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
- test_S2_get_book: AssertionError: 404 != 200
- test_S6_unknown_query_param: AssertionError: -1 != 400

The files from an earlier attempt are in /workspace; continue from them.
