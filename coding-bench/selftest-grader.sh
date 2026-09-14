#!/usr/bin/env bash
# selftest-grader.sh — prove grade-run.sh still grades correctly, with no GPU,
# no model and no llama-server. Runs in well under a minute.
#
# WHY: round 3' introduced a new task-3 grader (the books server: status, body
# and headers as three components) and rewrote the task-1/2 verdicts into the
# algo/pkg split. That is a lot of new grading code for a 12-hour round to
# depend on, and a model run is an expensive and unreliable way to test it — a
# smoke cell that runs out of budget before writing server.py exercises none of
# it. So synthesise the deliverables instead and assert the verdicts.
#
#   ./selftest-grader.sh          -> "ALL CHECKS PASSED" and exit 0, or a diff
#
# Ports: uses whatever CANDIDATE_PORTS grade-run.sh probes; the fixtures bind
# 8080. If that port is busy the grader refuses to start, which is itself the
# correct behaviour and is reported as such.
set -u
cd "$(dirname "$0")" || exit 1
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
R="$WORK/run"; mkdir -p "$R"

mk() { mkdir -p "$R/$1"; }

# --- task 3 fixtures: the books server ------------------------------------
# (a) the unmodified buggy original — a model that "fixed" nothing.
#     Valid JSON and 200, but no Content-Length. This is the case the task
#     exists to catch: plain curl shows a healthy server.
mk 03-r1-BUGGY
cat > "$R/03-r1-BUGGY/server.py" <<'EOF'
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/books":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(BOOKS).encode()
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()
HTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
EOF
# (b) a correct fix.
mk 03-r2-FIXED
cat > "$R/03-r2-FIXED/server.py" <<'EOF'
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
BOOKS = [
    {"id": 1, "title": "Dune", "author": "Frank Herbert"},
    {"id": 2, "title": "1984", "author": "George Orwell"},
]
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        if self.path == "/api/books":
            body = json.dumps(BOOKS).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            body = b'{"error": "not found"}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
EOF
# (c) a half-fix: Content-Length present but wrong. A real failure mode, and
#     the reason the probe compares the header to the actual body length
#     rather than just checking the header exists.
mk 03-r3-OFFBYONE
sed 's/str(len(body))/str(len(body) + 1)/' "$R/03-r2-FIXED/server.py" > "$R/03-r3-OFFBYONE/server.py"

# --- task 1 fixtures: the algo/pkg split ----------------------------------
# (d) correct algorithm, self-test scaffolding that will not import: the
#     packaging death the split exists to name. algo:PASS pkg:FAIL.
mk 01-r1-SCAFFOLD_DEATH
cat > "$R/01-r1-SCAFFOLD_DEATH/debounce.ts" <<'EOF'
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, waitMs);
    };
}
if (import.meta.main || process.argv[1] === __filename) {
    console.log("all tests passed");
}
EOF
# (e) wrong algorithm, file imports fine: algo:FAIL pkg:PASS.
mk 01-r2-LOGIC_BUG
cat > "$R/01-r2-LOGIC_BUG/debounce.ts" <<'EOF'
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(args); }, waitMs);
    };
}
EOF
# (f) fully correct: algo:PASS pkg:PASS.
mk 01-r3-GOOD
cat > "$R/01-r3-GOOD/debounce.ts" <<'EOF'
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, waitMs);
    };
}
EOF

./grade-run.sh "$R" >"$WORK/out" 2>&1 || { echo "grade-run.sh exited non-zero:"; tail -20 "$WORK/out"; exit 1; }

got="$(cut -f1,3,4 "$R/grades.tsv" | tail -n +2 | sort)"
want="$(sort <<'EOF'
1	GOOD	debounce.algo:PASS debounce.pkg:PASS
1	LOGIC_BUG	debounce.algo:FAIL debounce.pkg:PASS
1	SCAFFOLD_DEATH	debounce.algo:PASS debounce.pkg:FAIL
3	BUGGY	books.status:PASS books.body:PASS books.headers:FAIL
3	FIXED	books.status:PASS books.body:PASS books.headers:PASS
3	OFFBYONE	books.status:PASS books.body:PASS books.headers:FAIL
EOF
)"
if [[ "$got" == "$want" ]]; then
    echo "ALL CHECKS PASSED — grade-run.sh grades the algo/pkg split and all three"
    echo "books components as expected."
    grep -E 'headers\(' "$R/grades.tsv" | sed 's/^/  /' | cut -c1-140
    exit 0
fi
echo "MISMATCH. got (left) vs want (right):"
diff <(echo "$got") <(echo "$want")
echo
echo "--- full grades.tsv ---"; cat "$R/grades.tsv"
echo "--- grader output tail ---"; tail -25 "$WORK/out"
exit 1
