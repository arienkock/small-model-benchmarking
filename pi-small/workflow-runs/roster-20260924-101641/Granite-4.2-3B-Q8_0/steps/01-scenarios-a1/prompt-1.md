# Workflow step: scenarios

You are planning, not coding. Do not write any code in this step.

Read the task below and write the verification scenarios that will prove the finished work is correct: the happy paths (at least 3) and the unhappy paths — invalid input, missing items, errors (at least 3). At most 16 in total.
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

## Rules for this task

- Tests are Python unittest files in /workspace/tests/, named test_*.py; each test is a method named after its scenario.
- Tests that need the HTTP server start it themselves on a free port and shut it down afterwards.

Submit them a few at a time: call the tool `submit_scenarios` with three or four scenarios and `done: false`, then with the next few, and set `done: true` on the last call. It tells you what it has so far; if it reports problems, fix them and call it again.
