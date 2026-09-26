# Workflow step: breakdown

You are planning, not coding. Do not write any code in this step.

Break the task below into 2 to 6 small implementation tasks, in the order they should be built. Each task must be small enough to implement and test on its own, and later tasks may build on earlier ones. For each task give: title, goal (what exists when it is done), files (the files it creates or changes, including its test files), and covers (the ids of the whole-task scenarios whose tests belong to this task). Every scenario id must be covered by at least one task. Keep every field to one short sentence. Where a field shows code or JSON, write it with single quotes, for example {'title': 'Dune'}: the harness only reads it, and single quotes keep the tool call itself simple.

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

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

When you are done, call the tool `submit_breakdown` with the list of tasks. If it reports problems, fix them and call it again.
