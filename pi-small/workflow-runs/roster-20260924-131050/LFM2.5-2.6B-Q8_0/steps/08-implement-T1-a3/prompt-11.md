# Workflow step: implement T1

Implement task T1 (described at the end), together with a test for every scenario listed for it. Earlier tasks are already done and verified; keep their tests passing.

Rules:
- Work in /workspace.
- Every scenario needs an automated test that proves it. Tests go in files matching `tests/*.py`.
- Put the scenario id in the test's name, with the dot written as an underscore: scenario T2.S1 needs a test named like `test_T2_S1_<what>` (or "T2_S1: <what>" where tests are named with strings); whole-task scenario S4 needs one named like `test_S4_<what>`.
- The harness runs the whole test suite from /workspace with: `python3 -m unittest discover -s tests -v`. It must pass and finish within 300 seconds; run it yourself before you finish.
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

## Verification scenarios for the whole task

- **S1** [happy] Create book and get ID — Given No books exist yet; PORT=8000; when POST /books with {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}; then 201 Created response containing the new book with id 1
- **S2** [happy] Retrieve book by ID — Given Book with id=1 exists from previous create; when GET /books/1; then 200 OK with the book object including id: 1
- **S3** [unhappy] Create book missing required field — Given No books exist yet; PORT=8000; when POST /books with {"author": "Frank Herbert", "isbn": "12345"}; then 400 Bad Request with error message about missing title
- **S4** [unhappy] Update with invalid JSON — Given No books exist yet; PORT=8000; when PUT /books/1 with body "{invalid json}"; then 400 Bad Request with error message about invalid JSON
- **S5** [unhappy] Query with unknown parameter — Given Book with id=1 exists from previous create; PORT=8000; when GET /books?unknown_param=value; then 400 Bad Request with error about unknown query parameter
- **S6** [happy] Create book and receive ID — Given No books exist; PORT=8000; when POST /books with {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}; then 201 Created response containing the new book with id 1
- **S7** [happy] Fetch existing book by ID — Given Book with id=1 exists from previous create; PORT=8000; when GET /books/1; then 200 OK with the book object including id: 1
- **S8** [happy] List all books — Given Book with id=1 exists from previous create; PORT=8000; when GET /books; then 200 OK with a JSON list containing the book(s)
- **S9** [unhappy] Missing required field in create — Given No books exist yet; PORT=8000; when POST /books with {"author": "Frank Herbert", "isbn": "12345"}; then 400 Bad Request with error about missing title
- **S10** [unhappy] Invalid JSON body in PUT — Given No books exist yet; PORT=8000; when PUT /books/1 with body "{invalid json}"; then 400 Bad Request with error about invalid JSON
- **S11** [unhappy] Unknown query parameter — Given Book with id=1 exists from previous create; PORT=8000; when GET /books?unknown_param=value; then 400 Bad Request with error about unknown query parameter

## Implementation plan (tasks run in this order)

T1. **Basic server with CRUD operations** (not started) — Server runs on PORT env var, handles POST /books (create), GET /books/{id} (read), PUT /books/{id} (update), DELETE /books/{id} (delete) Files: app.py. Covers: S1, S2, S6, S7.
T2. **Search and filter on GET /books** (not started) — GET /books supports id=, title=..., author=..., isbn=..., synopsis=..., q=... query params with case-insensitive matching and all-or-nothing filtering Files: app.py. Covers: S8.
T3. **Comprehensive error handling** (not started) — Return proper JSON errors (400, 404) for missing required fields, invalid JSON in PUT, unknown query parameters, and non-existent books Files: app.py. Covers: S3, S4, S5, S9, S10, S11.

## Current task: T1 — Basic server with CRUD operations

Server runs on PORT env var, handles POST /books (create), GET /books/{id} (read), PUT /books/{id} (update), DELETE /books/{id} (delete)

Files: app.py

Whole-task scenarios this task must provide tests for:
- **S1** [happy] Create book and get ID — Given No books exist yet; PORT=8000; when POST /books with {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}; then 201 Created response containing the new book with id 1
- **S2** [happy] Retrieve book by ID — Given Book with id=1 exists from previous create; when GET /books/1; then 200 OK with the book object including id: 1
- **S6** [happy] Create book and receive ID — Given No books exist; PORT=8000; when POST /books with {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}; then 201 Created response containing the new book with id 1
- **S7** [happy] Fetch existing book by ID — Given Book with id=1 exists from previous create; PORT=8000; when GET /books/1; then 200 OK with the book object including id: 1

This task's own scenarios:
- **T1.S1** [happy] Create book and get ID — Given No books exist yet; PORT=8000; when POST /books with {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}; then 201 Created response containing the new book with id 1
- **T1.S2** [happy] Retrieve book by ID — Given Book with id=1 exists from previous create; PORT=8000; when GET /books/1; then 200 OK with the book object including id: 1
- **T1.S3** [happy] Fetch existing book by ID — Given Book with id=1 exists from previous create; PORT=8000; when GET /books/1; then 200 OK with the book object including id: 1
- **T1.S4** [unhappy] Create book missing required field — Given No books exist yet; PORT=8000; when POST /books with {"author": "Frank Herbert", "isbn": "12345"}; then 400 Bad Request with error message about missing title
- **T1.S5** [unhappy] Update with invalid JSON — Given No books exist yet; PORT=8000; when PUT /books/1 with body "{invalid json}"; then 400 Bad Request with error message about invalid JSON
- **T1.S6** [unhappy] Query with unknown parameter — Given Book with id=1 exists from previous create; PORT=8000; when GET /books?unknown_param=value; then 400 Bad Request with error about unknown query parameter
- **T1.S7** [unhappy] Missing required field in create (duplicate) — Given No books exist yet; PORT=8000; when POST /books with {"author": "Frank Herbert", "isbn": "12345"}; then 400 Bad Request with error about missing title
- **T1.S8** [unhappy] Invalid JSON body in PUT (duplicate) — Given No books exist yet; PORT=8000; when PUT /books/1 with body "{invalid json}"; then 400 Bad Request with error about invalid JSON
- **T1.S9** [unhappy] Unknown query parameter on list — Given Book with id=1 exists from previous create; PORT=8000; when GET /books?unknown_param=value; then 400 Bad Request with error about unknown query parameter

Implementation logic:
- Use Python 3 standard library (http.server, json, urllib.parse). Store books in a list of dicts keyed by id. Assign sequential integer IDs starting from 1. For POST /books: parse JSON body, validate required fields (title, author, isbn) are non-empty strings, create book with next ID and empty synopsis, return 201 with the full book dict. For GET /books/{id}: find book by id; if not found return 404, else return 200 with the book. For PUT /books/{id}: parse JSON body, validate required fields, update the book dict in place, return 200 with updated book. For DELETE /books/{id}: find and remove the book; if not found return 404, else return 204 with no body. All error responses are JSON objects {"error": "message"}. Unknown query parameters trigger a 400 error.

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.

## A previous attempt at this step failed

The harness checks did NOT pass:
- the test suite failed (`python3 -m unittest discover -s tests -v` exited 1).

Last lines of the test run:
```
^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/socket.py", line 851, in create_connection
    raise exceptions[0]
  File "/usr/lib/python3.11/socket.py", line 836, in create_connection
    sock.connect(sa)
ConnectionRefusedError: [Errno 111] Connection refused

======================================================================
ERROR: test_T1_S9_unknown_query_param_on_list (test_app.TestBookAPI.test_T1_S9_unknown_query_param_on_list)
T1.S9: Unknown query parameter on list - unhappy (400).
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/workspace/tests/test_app.py", line 189, in test_T1_S9_unknown_query_param_on_list
    response_status, _ = self._make_request(
                         ^^^^^^^^^^^^^^^^^^^
  File "/workspace/tests/test_app.py", line 53, in _make_request
    conn.request(method, path, body=json.dumps(body).encode())
  File "/usr/lib/python3.11/http/client.py", line 1302, in request
    self._send_request(method, url, body, headers, encode_chunked)
  File "/usr/lib/python3.11/http/client.py", line 1348, in _send_request
    self.endheaders(body, encode_chunked=encode_chunked)
  File "/usr/lib/python3.11/http/client.py", line 1297, in endheaders
    self._send_output(message_body, encode_chunked=encode_chunked)
  File "/usr/lib/python3.11/http/client.py", line 1057, in _send_output
    self.send(msg)
  File "/usr/lib/python3.11/http/client.py", line 995, in send
    self.connect()
  File "/usr/lib/python3.11/http/client.py", line 961, in connect
    self.sock = self._create_connection(
                ^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/socket.py", line 851, in create_connection
    raise exceptions[0]
  File "/usr/lib/python3.11/socket.py", line 836, in create_connection
    sock.connect(sa)
ConnectionRefusedError: [Errno 111] Connection refused

----------------------------------------------------------------------
Ran 10 tests in 1.054s

FAILED (errors=10)
```

The files from that attempt are still in /workspace; continue from them or replace them.
