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

- **S1** [happy] POST creates book with all fields — Given Book store starts empty in memory.; when POST /books with JSON {'title': 'Dune', 'author': 'Frank Herbert', 'isbn': '978-0441172719', 'synopsis': 'A vast empire and its conflict'}; then Response is 201 with JSON containing id 1, title 'Dune', author 'Frank Herbert', isbn '978-0441172719', synopsis 'A vast empire and its conflict'
- **S2** [happy] GET returns created book by id — Given Book with id 1 exists in memory.; when GET /books/1; then Response is 200 with JSON matching the stored book with id 1.
- **S3** [happy] PUT replaces book fields — Given Book id 1 exists with title 'Dune'.; when PUT /books/1 with JSON {'title': 'Dune 2', 'author': 'Frank Herbert Jr', 'isbn': '978-0441172720', 'synopsis': 'Updated synopsis'}; then Response is 200 with JSON containing title 'Dune 2', author 'Frank Herbert Jr', isbn '978-0441172720', synopsis 'Updated synopsis'
- **S4** [happy] GET /books lists books ordered by id — Given Books with id 1, 2 and 3 exist in memory.; when GET /books; then Response is 200 with JSON array of three books ordered by id 1, 2, 3.
- **S5** [unhappy] POST rejects invalid JSON body — Given Book store starts empty in memory.; when POST /books with body 'not-json' and Content-Type application/json; then Response is 400 with JSON {'error': '<message>'}.
- **S6** [unhappy] POST rejects missing required field — Given Book store starts empty in memory.; when POST /books with JSON {'title': 'Dune', 'isbn': '978-123'} (no author); then Response is 400 with JSON {'error': '<message>'}.
- **S7** [unhappy] POST rejects id in body — Given Book store starts empty in memory.; when POST /books with JSON {'id': 1, 'title': 'Dune'}; then Response is 400 with JSON {'error': '<message>'}.
- **S8** [unhappy] PUT rejects non-integer path id — Given Book store starts empty in memory.; when PUT /books/abc with JSON object; then Response is 400 with JSON {'error': '<message>'}.
- **S9** [unhappy] GET returns 404 for nonexistent book — Given Book store has books but not id 999.; when GET /books/999; then Response is 404 with JSON {'error': '<message>'}.
- **S10** [unhappy] DELETE returns 404 for nonexistent book — Given Book store has books but not id 999.; when DELETE /books/999; then Response is 404 with JSON {'error': '<message>'}.
- **S11** [unhappy] GET rejects unknown query parameter — Given Book store has books.; when GET /books?unknownParam=value; then Response is 400 with JSON {'error': '<message>'}.
- **S12** [unhappy] POST rejects wrong type field — Given Book store starts empty in memory.; when POST /books with JSON {'title': 123, 'author': 'X', 'isbn': 'Y'}; then Response is 400 with JSON {'error': '<message>'}.
- **S13** [unhappy] GET rejects non-integer path id — Given Book store has books.; when GET /books/notanumber; then Response is 400 with JSON {'error': '<message>'}.

## Implementation plan (tasks run in this order)

T1. **Server entry point and in-memory book store** (not started) — Set up HTTP server on 127.0.0.1 with PORT env (default 8000) and a thread-safe BookStore with auto-incrementing integer ids. Files: app.py. Covers: S1, S2, S4.
T2. **Request parsing and body validation for POST** (not started) — Parse JSON request bodies, validate required/optional fields and types, reject id in body, and reject invalid/missing fields with 400 responses. Files: app.py. Covers: S5, S6, S7, S12.
T3. **GET and PUT handlers with path id validation** (not started) — Implement GET /books/{id} and PUT /books/{id} endpoints, validating non-integer path ids, replacing book fields on PUT, and returning 404 for nonexistent books. Files: app.py. Covers: S3, S8, S9, S10, S13.
T4. **GET list with filtering and unknown query param handling** (not started) — Implement GET /books listing all books ordered by id, supporting field-level and q= search filters, rejecting unknown query parameters with 400. Files: app.py. Covers: S11.
T5. **DELETE endpoint integration** (not started) — Implement DELETE /books/{id} endpoint to remove a book and respond 204, returning 404 for nonexistent books. Files: app.py. Covers: S10.

## Current task: T1 — Server entry point and in-memory book store

Set up HTTP server on 127.0.0.1 with PORT env (default 8000) and a thread-safe BookStore with auto-incrementing integer ids.

Files: app.py

Whole-task scenarios this task must provide tests for:
- **S1** [happy] POST creates book with all fields — Given Book store starts empty in memory.; when POST /books with JSON {'title': 'Dune', 'author': 'Frank Herbert', 'isbn': '978-0441172719', 'synopsis': 'A vast empire and its conflict'}; then Response is 201 with JSON containing id 1, title 'Dune', author 'Frank Herbert', isbn '978-0441172719', synopsis 'A vast empire and its conflict'
- **S2** [happy] GET returns created book by id — Given Book with id 1 exists in memory.; when GET /books/1; then Response is 200 with JSON matching the stored book with id 1.
- **S4** [happy] GET /books lists books ordered by id — Given Books with id 1, 2 and 3 exist in memory.; when GET /books; then Response is 200 with JSON array of three books ordered by id 1, 2, 3.

This task's own scenarios:
- **T1.S1** [happy] POST creates book with all fields — Given Book store starts empty in memory.; when POST /books with JSON {'title': 'Dune', 'author': 'Frank Herbert', 'isbn': '978-0441172719', 'synopsis': 'A vast empire and its conflict'}; then Response is 201 with JSON containing id 1, title 'Dune', author 'Frank Herbert', isbn '978-0441172719', synopsis 'A vast empire and its conflict'
- **T1.S2** [happy] GET returns created book by id — Given Book with id 1 exists in memory.; when GET /books/1; then Response is 200 with JSON matching the stored book with id 1
- **T1.S3** [happy] GET lists books ordered by id — Given Books with id 1, 2 and 3 exist in memory.; when GET /books; then Response is 200 with JSON array of three books ordered by id 1, 2, 3
- **T1.S4** [unhappy] GET nonexistent book returns 404 — Given Book store has books but not id 999.; when GET /books/999; then Response is 404 with JSON {'error': '<message>'}

Implementation logic:
- Create app.py as the server entry point. It reads the PORT environment variable (default 8000) and binds an HTTP server to 127.0.0.1.
- Define a Book class (or namedtuple) with fields id (int), title (str), author (str), isbn (str), synopsis (str, defaulting to '').
- Implement a thread-safe BookStore class using threading.Lock. It maintains an ordered store of books and an auto-incrementing integer id counter starting at 1, so ids are assigned in creation order and never reused after a delete.
- The BookStore exposes create(title, author, isbn, synopsis) returning a Book with a fresh integer id; get(id) returning the Book or None; list() returning all books ordered by id; and delete(id) removing the book so its id is not reused.
- Start the HTTP server inside the main block using HTTPServer on the configured port (default 8000), serving from app.py and running until stopped.
- For T1 scope, the server must accept and route requests and respond 404 for nonexistent books via BookStore.get/delete returning None; body validation and field rules are covered by later tasks (T2-T3).

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.
