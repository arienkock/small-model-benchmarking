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

- **S1** [happy] create_book — Given empty in-memory store; when POST /books with JSON {"title": "1984", "author": "Orwell", "isbn": "123456"}; then 201 with {"id": 1, "title": "1984", "author": "Orwell", "isbn": "123456", "synopsis": ""}
- **S2** [happy] get_book — Given book id 1 exists; when GET /books/1; then 200 with the book object
- **S3** [happy] update_book — Given book id 1 exists; when PUT /books/1 with JSON {"title": "Nineteen Eighty-Four", "author": "George Orwell", "isbn": "123456", "synopsis": "A dystopian novel"}; then 200 with updated book
- **S4** [unhappy] missing_required_field — Given POST /books with JSON {"title": "Test", "author": "Author", "isbn": ""}; when send request; then 400 with error "isbn" is empty
- **S5** [unhappy] invalid_json_body — Given POST /books with non-JSON body; when send request with raw text; then 400 with error "error" (invalid JSON)
- **S6** [unhappy] unknown_query_param — Given GET /books with query ?id=1&unknown=foo; when make request; then 400 with error "unknown query parameter"
- **S7** [unhappy] id_not_integer — Given GET /books/abc; when request; then 404
- **S8** [happy] delete_book — Given book id 1 exists; when DELETE /books/1; then 204 with no body
- **S9** [happy] search_by_title — Given books exist with id 1 title "1984"; when GET /books?title=1984; then 200 with list containing book id 1
- **S10** [unhappy] duplicate_id_in_create — Given book id 1 already exists; when POST /books with same fields as book 1; then 400 with error "id" already used?
- **S11** [unhappy] empty_query_param — Given GET /books?foo=; when make request; then 400 with error "unknown query parameter"

## Implementation plan (tasks run in this order)

T1. **Create basic server and routing** (not started) — Server starts and handles simple routes; basic request/response structure Files: app.py. Covers: S1, S2, S3, S4, S5, S6, S7.
