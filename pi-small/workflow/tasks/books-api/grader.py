#!/usr/bin/env python3
"""grader.py — black-box acceptance grader for the books-api task (prompt.md).

    python3 grader.py [workspace]        (default /workspace)

Starts `python3 app.py` with PORT set, exercises the API over real HTTP, stops
it, and prints one JSON object: {"passed", "total", "startup", "checks": [...]}.
It knows nothing about the workflow or the model's own tests; it only knows the
task text. Exit code 0 when every check passed.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

WS = sys.argv[1] if len(sys.argv) > 1 else "/workspace"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()
BASE = f"http://127.0.0.1:{PORT}"


def call(method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text.strip() else None), r.headers
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            parsed = json.loads(text) if text.strip() else None
        except ValueError:
            parsed = text
        return e.code, parsed, e.headers


checks = []


def check(name, fn):
    try:
        detail = fn()
        checks.append({"name": name, "ok": True, "detail": detail or ""})
    except AssertionError as e:
        checks.append({"name": name, "ok": False, "detail": str(e)[:300]})
    except Exception as e:  # a crash, a timeout, a refused connection
        checks.append({"name": name, "ok": False, "detail": f"{type(e).__name__}: {e}"[:300]})


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def is_error(status, body, code):
    expect(status == code, f"expected {code}, got {status} {body!r}")
    expect(isinstance(body, dict) and isinstance(body.get("error"), str), f"expected a JSON {{'error': …}} body, got {body!r}")


def main():
    app = os.path.join(WS, "app.py")
    result = {"passed": 0, "total": 0, "startup": {"ok": False}, "checks": checks}
    if not os.path.isfile(app):
        result["startup"]["detail"] = "app.py does not exist"
        print(json.dumps(result))
        sys.exit(1)
    proc = subprocess.Popen(
        [sys.executable, "app.py"], cwd=WS, env={**os.environ, "PORT": str(PORT), "PYTHONPYCACHEPREFIX": tempfile.mkdtemp()},
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            try:
                socket.create_connection(("127.0.0.1", PORT), timeout=0.5).close()
                result["startup"] = {"ok": True}
                break
            except OSError:
                time.sleep(0.2)
        if not result["startup"]["ok"]:
            err = proc.stderr.read().decode()[-500:] if proc.poll() is not None else ""
            result["startup"]["detail"] = f"server did not accept connections on PORT={PORT} within 10 s. {err}"
        else:
            run_checks()
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    result["total"] = len(checks)
    result["passed"] = sum(c["ok"] for c in checks)
    print(json.dumps(result))
    sys.exit(0 if result["startup"]["ok"] and result["passed"] == result["total"] else 1)


def run_checks():
    b1 = {"title": "Dune", "author": "Frank Herbert", "isbn": "9780441013593", "synopsis": "Desert planet politics."}
    b2 = {"title": "Emma", "author": "Jane Austen", "isbn": "9780141439587"}
    b3 = {"title": "Persuasion", "author": "Jane Austen", "isbn": "9780141439686", "synopsis": "A second chance at love."}
    ids = {}

    def create_1():
        s, b, h = call("POST", "/books", b1)
        expect(s == 201, f"POST /books -> {s} {b!r}")
        expect(isinstance(b, dict) and isinstance(b.get("id"), int), f"created book has no integer id: {b!r}")
        expect({k: b.get(k) for k in b1} == b1, f"created book fields differ: {b!r}")
        ids["b1"] = b["id"]
    check("create returns 201 with an integer id and the fields", create_1)

    def create_defaults():
        s, b, _ = call("POST", "/books", b2)
        expect(s == 201, f"POST /books -> {s} {b!r}")
        expect(b.get("synopsis") == "", f"missing synopsis should default to \"\", got {b.get('synopsis')!r}")
        ids["b2"] = b["id"]
        s, b, _ = call("POST", "/books", b3)
        expect(s == 201, f"third POST -> {s}")
        ids["b3"] = b["id"]
        expect(ids["b1"] < ids["b2"] < ids["b3"], f"ids not increasing in creation order: {ids}")
    check("synopsis defaults to empty; ids increase", create_defaults)

    def get_one():
        s, b, h = call("GET", f"/books/{ids['b1']}")
        expect(s == 200, f"GET -> {s}")
        expect(b == {**b1, "id": ids["b1"]}, f"GET returned {b!r}")
        expect("application/json" in (h.get("Content-Type") or ""), f"Content-Type is {h.get('Content-Type')!r}")
    check("get by id returns the book as JSON", get_one)

    check("get unknown id -> 404 error", lambda: is_error(*call("GET", "/books/999999")[:2], 404))
    check("get non-integer id -> 400 error", lambda: is_error(*call("GET", "/books/abc")[:2], 400))
    check("unknown path -> 404", lambda: expect(call("GET", "/nope")[0] == 404, "expected 404"))

    def list_all():
        s, b, _ = call("GET", "/books")
        expect(s == 200 and isinstance(b, list), f"GET /books -> {s} {b!r}")
        expect([x.get("id") for x in b] == sorted(ids.values()), f"list not all books by id: {[x.get('id') for x in b]}")
    check("list returns all books ordered by id", list_all)

    def filt(query, expected_keys):
        s, b, _ = call("GET", "/books?" + query)
        expect(s == 200 and isinstance(b, list), f"?{query} -> {s} {b!r}")
        got = sorted(x.get("id") for x in b)
        want = sorted(ids[k] for k in expected_keys)
        expect(got == want, f"?{query} returned ids {got}, expected {want}")
    check("filter author substring, case-insensitive", lambda: filt("author=austen", ["b2", "b3"]))
    check("filter title", lambda: filt("title=DUNE", ["b1"]))
    check("filter isbn", lambda: filt("isbn=439686", ["b3"]))
    check("filter synopsis", lambda: filt("synopsis=love", ["b3"]))
    check("filter id", lambda: filt(f"id={ids.get('b2', 0)}", ["b2"]))
    check("filters combine with AND", lambda: filt("author=austen&title=emma", ["b2"]))
    check("q searches all text fields", lambda: filt("q=planet", ["b1"]))
    check("filter with no match -> empty list", lambda: filt("author=tolkien", []))
    check("unknown query parameter -> 400", lambda: is_error(*call("GET", "/books?colour=red")[:2], 400))

    def put_ok():
        new = {"title": "Dune Messiah", "author": "Frank Herbert", "isbn": "9780593098233", "synopsis": ""}
        s, b, _ = call("PUT", f"/books/{ids['b1']}", new)
        expect(s == 200 and b == {**new, "id": ids["b1"]}, f"PUT -> {s} {b!r}")
        s, b, _ = call("GET", f"/books/{ids['b1']}")
        expect(b.get("title") == "Dune Messiah", f"update not persisted: {b!r}")
    check("update replaces the fields and persists", put_ok)

    check("update unknown id -> 404", lambda: is_error(*call("PUT", "/books/999999", b2)[:2], 404))
    check("update missing required field -> 400", lambda: is_error(*call("PUT", f"/books/{ids['b2']}", {"title": "X", "author": "Y"})[:2], 400))
    check("create missing title -> 400", lambda: is_error(*call("POST", "/books", {"author": "A", "isbn": "1"})[:2], 400))
    check("create empty author -> 400", lambda: is_error(*call("POST", "/books", {"title": "T", "author": "", "isbn": "1"})[:2], 400))
    check("create wrong type -> 400", lambda: is_error(*call("POST", "/books", {"title": 5, "author": "A", "isbn": "1"})[:2], 400))
    check("create with client id -> 400", lambda: is_error(*call("POST", "/books", {**b2, "id": 77})[:2], 400))
    check("create invalid JSON -> 400", lambda: is_error(*call("POST", "/books", raw=b"{not json")[:2], 400))
    check("create JSON that is not an object -> 400", lambda: is_error(*call("POST", "/books", raw=b"[1, 2]")[:2], 400))

    def delete_ok():
        s, b, _ = call("DELETE", f"/books/{ids['b3']}")
        expect(s == 204, f"DELETE -> {s} {b!r}")
        expect(call("GET", f"/books/{ids['b3']}")[0] == 404, "deleted book still readable")
        s, b, _ = call("GET", "/books")
        expect(ids["b3"] not in [x.get("id") for x in b], "deleted book still listed")
    check("delete returns 204 and removes the book", delete_ok)
    check("delete unknown id -> 404", lambda: is_error(*call("DELETE", "/books/999999")[:2], 404))

    def ids_not_reused():
        s, b, _ = call("POST", "/books", b3)
        expect(s == 201 and b.get("id") > ids["b3"], f"new id {b.get('id') if isinstance(b, dict) else b} should be greater than deleted {ids['b3']}")
    check("ids are not reused after delete", ids_not_reused)


if __name__ == "__main__":
    main()
