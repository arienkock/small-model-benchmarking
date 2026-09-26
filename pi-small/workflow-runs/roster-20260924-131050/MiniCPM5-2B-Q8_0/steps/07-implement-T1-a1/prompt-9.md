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

- **S1** [happy] Create book — Given No books in store; when POST /books with {'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890'}; then 201 with {'id': 1, 'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890', 'synopsis': ''}
- **S2** [happy] Retrieve book — Given Book id 1 exists; when GET /books/1; then 200 with {'id': 1, 'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890', 'synopsis': ''}
- **S3** [happy] Update book — Given Book id 1 exists; when PUT /books/1 with {'title': 'Dune', 'author': 'Huxley', 'isbn': '0987654321', 'synopsis': 'A story of desert'}; then 200 with {'id': 1, 'title': 'Dune', 'author': 'Huxley', 'isbn': '0987654321', 'synopsis': 'A story of desert'}
- **S4** [happy] List books by query — Given Two books exist; when GET /books?q=1234567890; then 200 with a list containing the book id 1
- **S5** [unhappy] Invalid JSON body — Given Server running.; when POST /books with body 'not json'; then 400 with {'error': 'Invalid JSON'}
- **S6** [unhappy] Missing required field — Given Server running.; when POST /books with JSON {'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title is required'}
- **S7** [unhappy] Wrong type — Given Server running.; when POST /books with JSON {'title': 123, 'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title must be a string'}
- **S8** [unhappy] Unknown query param — Given GET /books; when GET /books?id=5; then 400 with {'error': 'id is not a valid query parameter'}
- **S9** [unhappy] Non-existent id — Given Server running.; when GET /books/999; then 404 with {}

## Implementation plan (tasks run in this order)

T1. **POST /books** (not started) — Implement POST /books with validation and 201 response. Files: app.py, tests/test_s1.py, tests/test_s5.py, tests/test_s6.py, tests/test_s7.py. Covers: S1, S5, S6, S7.
T2. **Get and update by id** (not started) — Implement GET /books/{id}, PUT /books/{id}, and 404 for non-existent id. Files: app.py, tests/test_s2.py, tests/test_s3.py, tests/test_s9.py. Covers: S2, S3, S9.
T3. **List with query filtering** (not started) — Implement GET /books with id, title, author, isbn, synopsis, q and unknown param error. Files: app.py, tests/test_s4.py, tests/test_s8.py. Covers: S4, S8.
T4. **Delete book** (not started) — Implement DELETE /books/{id} Files: app.py. Covers: none.

## Current task: T1 — POST /books

Implement POST /books with validation and 201 response.

Files: app.py, tests/test_s1.py, tests/test_s5.py, tests/test_s6.py, tests/test_s7.py

Whole-task scenarios this task must provide tests for:
- **S1** [happy] Create book — Given No books in store; when POST /books with {'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890'}; then 201 with {'id': 1, 'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890', 'synopsis': ''}
- **S5** [unhappy] Invalid JSON body — Given Server running.; when POST /books with body 'not json'; then 400 with {'error': 'Invalid JSON'}
- **S6** [unhappy] Missing required field — Given Server running.; when POST /books with JSON {'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title is required'}
- **S7** [unhappy] Wrong type — Given Server running.; when POST /books with JSON {'title': 123, 'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title must be a string'}

This task's own scenarios:
- **T1.S1** [happy] Create book — Given No books in store; when POST /books with {'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890'}; then 201 with {'id': 1, 'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890', 'synopsis': ''}
- **T1.S2** [unhappy] Invalid JSON body — Given Server running; when POST /books with body 'not json'; then 400 with {'error': 'Invalid JSON'}
- **T1.S3** [unhappy] Missing required field — Given Server running; when POST /books with JSON {'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title is required'}
- **T1.S4** [unhappy] Wrong type — Given Server running; when POST /books with JSON {'title': 123, 'author': 'Test', 'isbn': '000'}; then 400 with {'error': 'title must be a string'}

Implementation logic:
- In-memory list of book dicts; each dict has keys id, title, author, isbn, synopsis.
- Function parse_and_validate_body(body) returns dict or raises ValidationError.
- Function create_book(body) assigns id by len(books)+1, populates fields, sets synopsis default ''.
- Endpoint POST /books calls parse_and_validate_body, creates book, returns 201.
- Validation checks: body is dict, title/author/isbn are non-empty strings, types correct.
- Unknown query params and unknown path segments raise 400/404 respectively.

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.
