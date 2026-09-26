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

- **S1** [happy] Create book — Given empty database; when POST /books {"title": "The Great Book", "author": "John Doe", "isbn": "123456789"}; then 201 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789"}
- **S2** [happy] Get book by id — Given database contains book id 1; when GET /books/1; then 200 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}
- **S3** [happy] List books with id filter — Given database contains book id 1; when GET /books?id=1; then 200 with body [{"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}]
- **S4** [unhappy] Invalid JSON body — Given empty database; when POST /books "not json"; then 400 with body {"error": "invalid JSON"}
- **S5** [unhappy] Missing required title field (empty) — Given empty database; when POST /books {"title": "", "author": "John Doe", "isbn": "123456"}; then 400 with body {"error": "title is empty"}
- **S6** [unhappy] DELETE non-existent book — Given database contains book id 1; when DELETE /books/999; then 404 with no body
- **S7** [happy] Create_happy — Given empty database; when POST /books {"title": "The Great Book", "author": "John Doe", "isbn": "123456789"}; then 201 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789"}
- **S8** [happy] Get_happy — Given database contains book id 1; when GET /books/1; then 200 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}
- **S9** [happy] Filter_happy — Given database contains book id 1; when GET /books?id=1; then 200 with body [{"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}]
- **S10** [unhappy] Invalid_JSON — Given empty database; when POST /books "not json"; then 400 with body {"error": "invalid JSON"}
- **S11** [unhappy] Missing_title — Given empty database; when POST /books {"title": "", "author": "John Doe", "isbn": "123456"}; then 400 with body {"error": "title is empty"}
- **S12** [unhappy] Delete_nonexistent — Given database contains book id 1; when DELETE /books/999; then 404 with no body

## Implementation plan (tasks run in this order)

T1. **Create book endpoint (POST /books)** (not started) — Implement POST /books that creates a new book, handling JSON validation and storing in memory. Files: app.py. Covers: S1, S4, S5, S10, S11, S7.
T2. **Retrieve book by ID and list books with query filters (GET /books/{id}, GET /books)** (not started) — Implement GET /books/{id} and GET /books with id, title, author, isbn, synopsis, q filters. Files: app.py, tests/test_retrieve.py. Covers: S2, S3, S8, S9.
T3. **Delete book endpoint (DELETE /books/{id})** (not started) — Implement DELETE /books/{id} that removes a book and returns 404 for non-existent. Files: app.py. Covers: S6, S12.

## Current task: T2 — Retrieve book by ID and list books with query filters (GET /books/{id}, GET /books)

Implement GET /books/{id} and GET /books with id, title, author, isbn, synopsis, q filters.

Files: app.py, tests/test_retrieve.py

Whole-task scenarios this task must provide tests for:
- **S2** [happy] Get book by id — Given database contains book id 1; when GET /books/1; then 200 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}
- **S3** [happy] List books with id filter — Given database contains book id 1; when GET /books?id=1; then 200 with body [{"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}]
- **S8** [happy] Get_happy — Given database contains book id 1; when GET /books/1; then 200 with body {"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}
- **S9** [happy] Filter_happy — Given database contains book id 1; when GET /books?id=1; then 200 with body [{"id": 1, "title": "The Great Book", "author": "John Doe", "isbn": "123456789", "synopsis": ""}]

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When you are done, call the tool `submit_task_plan` with `scenarios` and `logic`. If it reports problems, fix them and call it again.
