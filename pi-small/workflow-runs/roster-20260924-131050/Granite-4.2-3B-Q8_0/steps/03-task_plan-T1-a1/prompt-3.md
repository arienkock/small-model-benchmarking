# Workflow step: task_plan T1

You are planning, not coding. Do not write any code in this step.

Plan task T1 (described at the end). Write (1) this task's own verification scenarios, which will become its tests: at least 1 happy and 1 unhappy, at most 10; and (2) the implementation logic: a short list of steps saying how the code will work — data structures, function names and signatures, validation and error handling.
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

T1. **Implement basic server and POST /books** (not started) — Server starts and POST /books returns created book for scenario S1 Files: app.py. Covers: S1.
T2. **Add GET, PUT, DELETE, and query filtering** (not started) — Full API works for all remaining scenarios S2-S12 Files: app.py. Covers: S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12.

## Current task: T1 — Implement basic server and POST /books

Server starts and POST /books returns created book for scenario S1

Files: app.py

Whole-task scenarios this task must provide tests for:
- **S1** [happy] Create book — Given empty in-memory store; when POST /books with {"title":"Python","author":"Doe","isbn":"123456"}; then 201 with {"id":1,"title":"Python","author":"Doe","isbn":"123456","synopsis":""}

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When you are done, call the tool `submit_task_plan` with `scenarios` and `logic`. If it reports problems, fix them and call it again.
