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

- **S1** [happy] create_book — Given empty in-memory DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 201 with book id 1 and full book JSON
- **S2** [happy] get_book — Given book id 1 exists; when GET /books/1; then 200 with book JSON
- **S3** [happy] update_book — Given book id 1 exists; when PUT /books/1 with {"title":"New","author":"Author2","isbn":"99999","synopsis":"desc"}; then 200 with updated book JSON
- **S4** [unhappy] missing_required_field — Given empty DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 400 with error about missing field
- **S5** [happy] create_book1 — Given empty in-memory DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 201 with book id 1 and full book JSON
- **S6** [happy] get_book1 — Given book id 1 exists; when GET /books/1; then 200 with book JSON
- **S7** [happy] update_book1 — Given book id 1 exists; when PUT /books/1 with {"title":"New","author":"Author2","isbn":"99999","synopsis":"desc"}; then 200 with updated book JSON
- **S8** [unhappy] missing_field — Given empty DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 400 with error about missing field
- **S9** [unhappy] invalid_json_body — Given empty DB; when POST /books with "{invalid}"; then 400 with error about invalid JSON
- **S10** [unhappy] unknown_query_param — Given book id 1 exists; when GET /books?unknown=foo; then 400 with error about unknown query parameter
- **S11** [unhappy] not_found_id — Given book id 1 exists; when GET /books/999; then 404 with error about book not found

## Implementation plan (tasks run in this order)

T1. **Create server skeleton and basic routing** (not started) — Server starts, defines /books route, runs on PORT Files: app.py. Covers: S1, S2, S3, S4, S5.
T2. **Implement book storage and CRUD** (not started) — In-memory book list, POST, GET, PUT, DELETE work Files: app.py. Covers: S2, S3, S6, S7, S8, S9.
T3. **Add query filtering and error handling** (not started) — GET /books supports id, title, author, isbn, synopsis, q params; validates unknown params; returns 400/404 as required Files: app.py. Covers: S10, S11.

## Current task: T1 — Create server skeleton and basic routing

Server starts, defines /books route, runs on PORT

Files: app.py

Whole-task scenarios this task must provide tests for:
- **S1** [happy] create_book — Given empty in-memory DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 201 with book id 1 and full book JSON
- **S2** [happy] get_book — Given book id 1 exists; when GET /books/1; then 200 with book JSON
- **S3** [happy] update_book — Given book id 1 exists; when PUT /books/1 with {"title":"New","author":"Author2","isbn":"99999","synopsis":"desc"}; then 200 with updated book JSON
- **S4** [unhappy] missing_required_field — Given empty DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 400 with error about missing field
- **S5** [happy] create_book1 — Given empty in-memory DB; when POST /books with {"title":"Test","author":"Author","isbn":"12345"}; then 201 with book id 1 and full book JSON

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When you are done, call the tool `submit_task_plan` with `scenarios` and `logic`. If it reports problems, fix them and call it again.
