#!/usr/bin/env python3
"""http_fuzz.py — a task check: the workspace's HTTP server survives any request.

Not part of the harness: a task opts in from its task.json, e.g.

    "checks": [{"name": "HTTP server survives malformed requests",
                "command": "python3 /opt/pi-small/workflow/checks/http_fuzz.py"}]

Run from the workspace (or pass it as the first argument). It knows nothing
about the task's spec. It imports the entry module (default app.py, --entry
to change) and serves it in-process on a free port: through the module's own
server factory if it has one (make_server(0), create_server(0), …), else its
http.server.BaseHTTPRequestHandler subclass. The requests it sends come from
the workspace's own source (ast, every non-test .py file), not from a spec:

  - routes: string constants that start with "/" (or a path regex's literal
    prefix), tried as they are, with a path segment after them (an existing
    id, a missing one, a non-integer, empty) and with junk glued on;
  - names: string constants the code uses as dict keys, `.get()` arguments,
    `in` tests, or members of a literal tuple/set/list — used both as JSON
    body fields and as query parameters;
  - methods: the handler's do_* methods.

For each route that accepts a POST it first finds a body the server takes
(2xx), then varies it one field at a time: missing, null, empty, blank,
number, bool, list, object. It also sends bodies that are not JSON objects,
and each name as a query parameter with odd values.

The oracle needs no spec: a request fails only if the handler raises (the
exception and the workspace line it came from are reported), the status is
5xx, or it takes longer than --timeout seconds. A dropped connection with no
exception behind it is not a failure: that is a server answering before it
read the body (a reset on some platforms). Any 2xx/3xx/4xx is accepted, so "404 where the spec says
400" is out of scope — that takes a spec.

Prints one entry per distinct failure (same exception at the same line counts
once) with up to three requests that caused it, one per distinct message,
simplest first; then, per source file, which lines inside functions no
request reached — often dead code, or a branch that needs a state the
requests never set up. Exit 1 when anything failed.
"""
import argparse
import ast
import http.client
import http.server
import importlib.util
import inspect
import itertools
import json
import os
import socketserver
import sys
import threading
import time
import traceback

MUTANTS = [("missing", None), ("null", None), ("empty", ""), ("blank", " "), ("number", 1),
           ("negative", -1), ("float", 1.5), ("bool", True), ("list", []), ("object", {})]
SEGMENTS = ["{id}", "999999", "0", "-1", "abc", "1.5", "", "%20", "{id}/extra"]
QUERY_VALUES = ["abc", "1", "", "0", "-1", "1.5", "%zz"]
NON_OBJECT_BODIES = ["[]", '"text"', "1", "null", "true", "{", "", "not json"]


SKIP_DIRS = {".home", ".workflow", "__pycache__", ".git", "node_modules", ".venv", "venv"}


def source_files(ws):
    """The workspace's own .py files, tests left out."""
    out = []
    for root, dirs, files in os.walk(ws):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".") and not d.startswith("test")]
        out += [os.path.join(root, f) for f in files
                if f.endswith(".py") and not f.startswith("test_") and not f.endswith("_test.py")]
    return sorted(out)


def load(ws, entry):
    """The server to fuzz: the entry module's own server factory if it has one
    (a top-level function with "server" in its name that, given port 0 or
    nothing, returns a socketserver server), else its handler class served by
    a plain HTTPServer."""
    sys.path.insert(0, ws)
    spec = importlib.util.spec_from_file_location("_fuzz_target", os.path.join(ws, entry))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name, fn in vars(mod).items():
        if "server" in name.lower() and inspect.isfunction(fn) and fn.__module__ == mod.__name__:
            for call in (lambda: fn(0), fn):
                try:
                    server = call()
                except Exception:
                    continue
                if isinstance(server, socketserver.BaseServer):
                    return server, f"{name}()"
                break
    handlers = [v for v in vars(mod).values() if isinstance(v, type)
                and issubclass(v, http.server.BaseHTTPRequestHandler)
                and v.__module__ == mod.__name__]
    if not handlers:
        sys.exit(f"{entry}: no server factory (a function with 'server' in its name) and no "
                 "http.server.BaseHTTPRequestHandler subclass at module level")
    return http.server.HTTPServer(("127.0.0.1", 0), handlers[0]), handlers[0].__name__


REGEX_META = "()[]?*+.\\$|{^"


def harvest(paths):
    """Routes and names from the workspace's source: string constants that
    look like paths (or a path regex's literal prefix), and the keys the code
    looks up."""
    routes, names = set(), set()

    def strconst(n):
        return n.value if isinstance(n, ast.Constant) and isinstance(n.value, str) else None

    for path in paths:
        try:
            tree = ast.parse(open(path, encoding="utf-8", errors="replace").read())
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            s = strconst(n)
            if s and s.lstrip("^").startswith("/"):
                s = s.lstrip("^")
                cut = next((i for i, ch in enumerate(s) if ch in REGEX_META), len(s))
                routes.add(s[:cut] or "/")
            if isinstance(n, ast.Subscript) and strconst(n.slice):
                names.add(strconst(n.slice))
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("get", "pop", "setdefault") and n.args and strconst(n.args[0]):
                names.add(strconst(n.args[0]))
            if isinstance(n, (ast.Tuple, ast.Set, ast.List)):
                names.update(strconst(e) for e in n.elts if strconst(e))
            if isinstance(n, ast.Compare) and any(isinstance(o, (ast.In, ast.NotIn)) for o in n.ops) and strconst(n.left):
                names.add(strconst(n.left))
    names = {s for s in names if s.isidentifier()}
    return sorted(routes), sorted(names)


class Target:
    def __init__(self, server, timeout):
        self.errors = []
        self.timeout = timeout
        self.server = server
        server.handle_error = lambda request, addr: self.errors.append(sys.exc_info())
        server.RequestHandlerClass.log_message = lambda *a, **k: None
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def send(self, method, path, body=None):
        """(status, parsed-or-raw body, error-or-None) for one request."""
        before = len(self.errors)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)
        headers = {}
        if body is not None:
            headers = {"Content-Type": "application/json", "Content-Length": str(len(body.encode()))}
        t0 = time.monotonic()
        status, data, problem = None, None, None
        try:
            conn.request(method, path, body=body.encode() if body is not None else None, headers=headers)
            resp = conn.getresponse()
            status, raw = resp.status, resp.read()
            try:
                data = json.loads(raw) if raw else None
            except ValueError:
                data = raw
        except TimeoutError:
            problem = ("hang", f"no response within {self.timeout}s")
        except (http.client.HTTPException, ConnectionError) as e:
            problem = ("dropped", f"connection dropped without a response ({type(e).__name__})")
        finally:
            conn.close()
        # handle_error runs before the server closes the socket, so an exception
        # is recorded by the time we see the close; the short wait is for a
        # handler that answered with a Content-Length and THEN raised.
        deadline = time.monotonic() + 0.002
        while len(self.errors) == before and time.monotonic() < deadline:
            time.sleep(0.0005)
        if len(self.errors) > before:
            problem = ("raised", self.errors[before])
        elif problem and problem[0] == "dropped":
            # Every exception out of the handler goes through handle_error, so a
            # drop without one is the server answering and closing before it
            # read our body (a reset on some platforms), not a crash.
            problem = None
        elif problem is None and status is not None and status >= 500:
            problem = ("5xx", f"status {status}")
        if problem is None and time.monotonic() - t0 > self.timeout:
            problem = ("hang", f"took {time.monotonic() - t0:.1f}s")
        return status, data, problem


def where(exc_info, ws):
    """The innermost traceback frame inside the workspace, as (file, line, code)."""
    frames = [f for f in traceback.extract_tb(exc_info[2]) if os.path.abspath(f.filename).startswith(ws)]
    f = frames[-1] if frames else traceback.extract_tb(exc_info[2])[-1]
    return os.path.relpath(f.filename, ws).replace(os.sep, "/"), f.lineno, (f.line or "").strip()


def ids_in(data):
    if isinstance(data, dict):
        return [v for k, v in data.items() if k == "id" and isinstance(v, int)]
    if isinstance(data, list):
        return [i for d in data for i in ids_in(d)]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ws", nargs="?", default=".")
    ap.add_argument("--entry", default="app.py")
    ap.add_argument("--timeout", type=float, default=5.0)
    ap.add_argument("--verbose", action="store_true", help="print every request and its status")
    args = ap.parse_args()
    ws = os.path.abspath(args.ws)
    sources = source_files(ws)
    watched = set(sources)
    hits = set()  # (file, line)
    stop_coverage = start_coverage(watched, hits)

    server, served_by = load(ws, args.entry)
    handler = server.RequestHandlerClass
    methods = sorted(m[3:] for m in dir(handler) if m.startswith("do_") and m[3:].isalpha() and m[3:].isupper())
    routes, names = harvest(sources)
    target = Target(server, args.timeout)
    failures = {}  # key -> (problem text, [up to 3 requests, one per distinct message])
    sent = 0

    def req(method, path, body=None):
        nonlocal sent
        sent += 1
        status, data, problem = target.send(method, path, body)
        shown = f"{method} {path}" + (f" {body}" if body is not None else "")
        if args.verbose:
            print(f"  {status} {shown}" + (f"  <- {problem[0]}" if problem else ""))
        if problem:
            kind, detail = problem
            if kind == "raised":
                file, line, code = where(detail, ws)
                exc = detail[1]
                key = (type(exc).__name__, file, line)
                text, example = f"{type(exc).__name__} at {file}:{line} `{code}`", f"{type(exc).__name__}: {exc}"
            else:
                key, text, example = (kind, method, path.split("?")[0]), detail, detail
            text0, examples = failures.setdefault(key, (text, {}))
            if example not in examples and len(examples) < 3:
                examples[example] = shown
        return status, data

    known_ids = []
    body_routes = []  # (route, accepted base body)
    if "POST" in methods:
        for route in routes:
            accepted = None
            # the largest set of names the server accepts as strings, then as numbers
            for value in ("x", 1):
                for size in range(len(names), 0, -1):
                    for combo in itertools.combinations(names, size):
                        status, data = req("POST", route, json.dumps({k: value for k in combo}))
                        if status and 200 <= status < 300:
                            accepted = {k: value for k in combo}
                            known_ids += ids_in(data)
                            break
                    if accepted:
                        break
                if accepted:
                    break
            if accepted:
                body_routes.append((route, accepted))
    if not known_ids:
        for route in routes:
            known_ids += ids_in(req("GET", route)[1])
    some_id = str(known_ids[0]) if known_ids else "1"

    def paths(route):
        out = [route, route + "x", route.rstrip("/") + "/"]
        base = route.rstrip("/") + "/"
        out += [base + s.replace("{id}", some_id) for s in SEGMENTS]
        return list(dict.fromkeys(out))

    def body_variants(base):
        yield json.dumps(base)
        for field in names:
            for label, value in MUTANTS:
                b = dict(base)
                if label == "missing":
                    if field not in b:
                        continue
                    del b[field]
                else:
                    b[field] = value
                yield json.dumps(b)
        yield from NON_OBJECT_BODIES

    all_paths = list(dict.fromkeys(p for r in routes for p in paths(r)))
    for p in all_paths:
        req("GET", p)
    for p in routes:
        for name in names:
            for v in QUERY_VALUES:
                req("GET", f"{p}?{name}={v}")
        req("GET", f"{p}?zz_unknown=1")
        for a, b in itertools.combinations(names, 2):
            req("GET", f"{p}?{a}=x&{b}=x")
    base_body = body_routes[0][1] if body_routes else {k: "x" for k in names}
    for method in ("POST", "PUT", "PATCH"):
        if method not in methods:
            continue
        for p in all_paths:
            bodies = body_variants(base_body) if (method != "POST" or any(p == r for r, _ in body_routes)) else [json.dumps(base_body)]
            for b in bodies:
                req(method, p, b)
    if "DELETE" in methods:
        for p in all_paths:
            req("DELETE", p)

    target.server.shutdown()
    for text, examples in failures.values():
        print(f"FAIL  {text}")
        for example, shown in examples.items():
            print(f"      {shown}\n        -> {example}")
    stop_coverage()
    print(f"{len(failures)} distinct failure(s) from {sent} requests to {served_by}; "
          f"methods {','.join(methods)}; routes {routes}; names {names}")
    for path in sources:
        # Lines inside functions and class bodies; module-level code (imports,
        # the __main__ block, which is bypassed on purpose) says nothing.
        src = open(path, encoding="utf-8", errors="replace").read()
        try:
            top = compile(src, path, "exec")
        except SyntaxError:
            continue
        lines, stack = set(), [k for k in top.co_consts if hasattr(k, "co_lines")]
        while stack:
            c = stack.pop()
            lines.update(l for _, _, l in c.co_lines() if l)
            stack.extend(k for k in c.co_consts if hasattr(k, "co_lines"))
        defs = {n.lineno for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        lines -= defs
        got = {l for f, l in hits if f == path}
        missed = sorted(lines - got)
        rel = os.path.relpath(path, ws).replace(os.sep, "/")
        print(f"reached {len(lines & got)}/{len(lines)} lines of {rel}"
              + (f"; never reached: {ranges(missed)}" if missed else ""))
    sys.exit(1 if failures else 0)


def ranges(nums):
    out, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        out.append(str(nums[i]) if i == j else f"{nums[i]}-{nums[j]}")
        i = j + 1
    return ",".join(out)


def start_coverage(files, hits):
    """Record (file, line) for every line run in `files`, in every thread.
    sys.monitoring where there is one (3.12+), sys/threading.settrace before."""
    mon = getattr(sys, "monitoring", None)
    if mon:
        tool = mon.COVERAGE_ID
        mon.use_tool_id(tool, "http_fuzz")

        def on_line(code, line):
            if code.co_filename in files:
                hits.add((code.co_filename, line))
            return mon.DISABLE
        mon.register_callback(tool, mon.events.LINE, on_line)
        mon.set_events(tool, mon.events.LINE)

        def stop():
            mon.set_events(tool, 0)
            mon.free_tool_id(tool)
        return stop

    def local(frame, event, arg):
        if event == "line":
            hits.add((frame.f_code.co_filename, frame.f_lineno))
        return local

    def tracer(frame, event, arg):
        return local if frame.f_code.co_filename in files else None
    sys.settrace(tracer)
    threading.settrace(tracer)

    def stop():
        sys.settrace(None)
        threading.settrace(None)
    return stop


if __name__ == "__main__":
    main()
