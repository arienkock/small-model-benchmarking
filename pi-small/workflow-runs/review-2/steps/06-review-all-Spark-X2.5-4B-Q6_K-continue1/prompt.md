# Review (continued)

The code in /workspace was written for the task below. Do not change any files.

Review the code for completeness: is everything the task asks for there?
Review the code for correctness: does it work, and is it free of bugs?
Review the code for fidelity against the task: does what it does match what the task says, exactly?

A previous session ran out of turns before it finished this review. Below is what it found so far. Continue the review, then report all of it in one call to the tool `submit_findings` — most important first, and including whatever below still holds.

## Findings so far

- [high] Required field type validation missing - AttributeError on wrong type (/workspace/app.py): Required fields (title, author, isbn) lack proper type validation. When a client sends these fields with a non-string type (e.g., integer, null), the code calls `.strip()` on the value (e.g., `title.strip()`), which raises AttributeError. This causes unhandled server errors/crashes instead of returning a proper 400 Bad Request. For example, sending title: 123 results in an AttributeError crash instead of a 400 error response. The code should validate that title, author, and isbn are strings before processing.
- [high] Synopsis field does not handle null or wrong-type values correctly (/workspace/app.py): The synopsis field uses `synopsis = data.get('synopsis', '')`, which stores None when the client sends `synopsis: null`, and stores the raw wrong-type value when synopsis has a non-string type (e.g., number). This does not validate that synopsis is a string. Responses show `synopsis: null` (null synopsis) or `synopsis: 123` (wrong type) instead of defaulting to an empty string or returning a 400 error. The field is specified as a string that defaults to an empty string, so null/wrong-type values should be rejected or normalized.
- [medium] PUT with null synopsis returns incorrect field value (/workspace/app.py): When a PUT request is made with `synopsis: null`, the endpoint returns 200 but stores/returns `synopsis: null` in the response. This is inconsistent with the field being a string that defaults to an empty string. The response should either return the default empty string or properly handle null as invalid (returning 400). Additionally, non-integer path IDs and unknown query parameters may not return proper 400 error responses, failing the task requirement for specific error responses.
- [low] Unused imports (sys, threading) in app.py (/workspace/app.py): The imports for `sys` and `threading` are present but never used in the code. These are unused imports that add unnecessary clutter and could be removed.

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
