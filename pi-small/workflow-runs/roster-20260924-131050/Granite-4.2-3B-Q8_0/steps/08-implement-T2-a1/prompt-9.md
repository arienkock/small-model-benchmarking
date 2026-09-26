# Workflow step: implement T2

Implement task T2 (described at the end), together with a test for every scenario listed for it. Earlier tasks are already done and verified; keep their tests passing.

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

- **S1** [happy] Create book — Given empty in-memory store; when POST /books with {"title":"Python","author":"Doe","isbn":"123456"}; then 201 with {"id":1,"title":"Python","author":"Doe","isbn":"123456","synopsis":""}
- **S2** [happy] Get created book — Given book id 1 exists; when GET /books/1; then 200 with the created book JSON
- **S3** [happy] Update book — Given book id 1 exists; when PUT /books/1 with {"title":"Python Programming","author":"Smith","isbn":"123456","synopsis":"A guide"}; then 200 with updated book JSON
- **S4** [happy] Delete book — Given book id 1 exists; when DELETE /books/1; then 204 no body
- **S5** [unhappy] Missing required field — Given POST /books with {"title":"Test","author":"Author"}; when send request; then 400 with {"error":"missing required field isbn"}
- **S6** [unhappy] Empty title — Given POST /books with {"title":"","author":"Author","isbn":"123"}; when send request; then 400 with {"error":"title is required and not empty"}
- **S7** [unhappy] Non-integer id in path — Given empty store; when GET /books/abc; then 404
- **S8** [unhappy] Unknown query parameter — Given GET /books with params {"id":1,"invalid":"foo"}; when request; then 400 with {"error":"unknown query parameter invalid"}
- **S9** [happy] Search by id — Given book id 1 exists; when GET /books?id=1; then 200 with [{"id":1,"title":"Python","author":"Doe","isbn":"123456","synopsis":""}]
- **S10** [happy] Filter by title contains — Given book id 1 exists and title contains 'Python'; when GET /books?title=python; then 200 with [{"id":1,...}]
- **S11** [unhappy] Invalid query param repeated — Given empty store; when GET /books?id=1&id=2; then 400 with {"error":"unknown query parameter id"}
- **S12** [unhappy] Multiple conflicting filters return 404 — Given book id 1 exists; when GET /books?id=1&title=nonexistent; then 404

## Implementation plan (tasks run in this order)

T1. **Implement basic server and POST /books** (done) — Server starts and POST /books returns created book for scenario S1 Files: app.py. Covers: S1.
T2. **Add GET, PUT, DELETE, and query filtering** (not started) — Full API works for all remaining scenarios S2-S12 Files: app.py. Covers: S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12.

## Current task: T2 — Add GET, PUT, DELETE, and query filtering

Full API works for all remaining scenarios S2-S12

Files: app.py

Whole-task scenarios this task must provide tests for:
- **S2** [happy] Get created book — Given book id 1 exists; when GET /books/1; then 200 with the created book JSON
- **S3** [happy] Update book — Given book id 1 exists; when PUT /books/1 with {"title":"Python Programming","author":"Smith","isbn":"123456","synopsis":"A guide"}; then 200 with updated book JSON
- **S4** [happy] Delete book — Given book id 1 exists; when DELETE /books/1; then 204 no body
- **S5** [unhappy] Missing required field — Given POST /books with {"title":"Test","author":"Author"}; when send request; then 400 with {"error":"missing required field isbn"}
- **S6** [unhappy] Empty title — Given POST /books with {"title":"","author":"Author","isbn":"123"}; when send request; then 400 with {"error":"title is required and not empty"}
- **S7** [unhappy] Non-integer id in path — Given empty store; when GET /books/abc; then 404
- **S8** [unhappy] Unknown query parameter — Given GET /books with params {"id":1,"invalid":"foo"}; when request; then 400 with {"error":"unknown query parameter invalid"}
- **S9** [happy] Search by id — Given book id 1 exists; when GET /books?id=1; then 200 with [{"id":1,"title":"Python","author":"Doe","isbn":"123456","synopsis":""}]
- **S10** [happy] Filter by title contains — Given book id 1 exists and title contains 'Python'; when GET /books?title=python; then 200 with [{"id":1,...}]
- **S11** [unhappy] Invalid query param repeated — Given empty store; when GET /books?id=1&id=2; then 400 with {"error":"unknown query parameter id"}
- **S12** [unhappy] Multiple conflicting filters return 404 — Given book id 1 exists; when GET /books?id=1&title=nonexistent; then 404

This task's own scenarios:
- **T2.S1** [happy] Get created book — Given book id 1 exists; when GET /books/1; then 200 with the created book JSON
- **T2.S2** [happy] Update book — Given book id 1 exists; when PUT /books/1 with {"title":"Python Programming","author":"Smith","isbn":"123456","synopsis":"A guide"}; then 200 with updated book JSON
- **T2.S3** [happy] Delete book — Given book id 1 exists; when DELETE /books/1; then 204 no body
- **T2.S4** [unhappy] Missing required field — Given POST /books with {"title":"Test","author":"Author"}; when send request; then 400 with {"error":"missing required field isbn"

Implementation logic:
- use dict for books keyed by id, store list; handle POST validation; GET id; PUT update; DELETE remove; parse query params; validate id integer; check path id; filter matching all params; reject duplicate id param; return 404 for missing book or conflicting filters

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.
