# Workflow step: task_plan T2

You are planning, not coding. Do not write any code in this step.

Plan task T2 (described at the end). Write (1) this task's own verification scenarios, which will become its tests: at least 1 happy and 1 unhappy, at most 10; and (2) the implementation logic: a short list of steps saying how the code will work — data structures, function names and signatures, validation and error handling.
Each scenario has: kind ("happy" or "unhappy"), title, given (the starting state), when (the exact action, with concrete input values), then (the exact observable result: output, return value, file contents, status code or error). Make every scenario falsifiable: someone must be able to run it and see it pass or fail. No vague words like "works", "correctly" or "appropriate".
Keep every field to one short sentence. Where a field shows code or JSON, write it with single quotes, for example {'title': 'Dune'}: the harness only reads it, and single quotes keep the tool call itself simple.

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

## Current task: T2 — Get and update by id

Implement GET /books/{id}, PUT /books/{id}, and 404 for non-existent id.

Files: app.py, tests/test_s2.py, tests/test_s3.py, tests/test_s9.py

Whole-task scenarios this task must provide tests for:
- **S2** [happy] Retrieve book — Given Book id 1 exists; when GET /books/1; then 200 with {'id': 1, 'title': 'Dune', 'author': 'Sparaway', 'isbn': '1234567890', 'synopsis': ''}
- **S3** [happy] Update book — Given Book id 1 exists; when PUT /books/1 with {'title': 'Dune', 'author': 'Huxley', 'isbn': '0987654321', 'synopsis': 'A story of desert'}; then 200 with {'id': 1, 'title': 'Dune', 'author': 'Huxley', 'isbn': '0987654321', 'synopsis': 'A story of desert'}
- **S9** [unhappy] Non-existent id — Given Server running.; when GET /books/999; then 404 with {}

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When you are done, call the tool `submit_task_plan` with `scenarios` and `logic`. If it reports problems, fix them and call it again.
