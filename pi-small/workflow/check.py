#!/usr/bin/env python3
"""check.py — the harness's own verdict on a workspace. Runs in the sandbox.

    python3 check.py <check-spec.json> [workspace]      (workspace defaults to /workspace)

Prints one JSON object (CheckReport in ../lib/workflow.ts) and exits 0 when every
check passed, 1 otherwise. It knows no language or test framework; the spec
says how to run the tests (see CheckSpec). Checks, none of them trusting the model:

  tokens   every required scenario token (S3, T2_S1, I2) appears in some test file
  suite    `testCommand` exits 0 within `testTimeoutSec` (and, with
           `testCountPattern`, reports more than zero tests)
  checks   each task-specific command in `checks` exits 0
"""
import fnmatch
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile

SKIP_DIRS = {".home", ".workflow", ".git", "node_modules", "__pycache__", ".venv", "venv", "target", "dist", "build"}
POSIX = os.name == "posix"


def workspace_files(ws):
    for root, dirs, files in os.walk(ws):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            yield os.path.relpath(os.path.join(root, f), ws).replace(os.sep, "/")


def glob_match(path, pattern):
    """fnmatch where **/ may also match nothing: tests/**/*.py matches tests/test_a.py."""
    return fnmatch.fnmatchcase(path, pattern) or ("**/" in pattern and fnmatch.fnmatchcase(path, pattern.replace("**/", "")))


def test_files(ws, globs):
    files = []
    for rel in workspace_files(ws):
        if globs:
            if any(glob_match(rel, g) for g in globs):
                files.append(rel)
        elif re.search(r"test|spec", rel, re.I):
            files.append(rel)
    return files


def token_regex(token):
    """S3 must not match inside T2_S3 or S30; T2_S1 not inside T2_S10."""
    guard = r"(?<![A-Za-z0-9])"
    if re.fullmatch(r"S\d+", token):
        guard += r"(?<!T\d_)(?<!T\d\d_)"
    return re.compile(guard + re.escape(token) + r"(?![A-Za-z0-9])")


def kill_tree(p):
    """The command and anything it started — its process group in the (Linux)
    container; on Windows, where the unit tests run it, the process tree, since a
    surviving grandchild would hold the output pipe open until it exits."""
    try:
        if POSIX:
            os.killpg(p.pid, signal.SIGKILL)
        elif p.poll() is None:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
    except ProcessLookupError:
        pass


def run(command, ws, timeout):
    """Run a shell command from the workspace. Returns (rc, or None on timeout; output)."""
    # A private Python bytecode cache per run: __pycache__ is validated by source
    # mtime + size, so a one-character fix saved within the same second as the
    # previous run silently executes the OLD code. Inert for anything but Python.
    env = {**os.environ, "PYTHONPYCACHEPREFIX": tempfile.mkdtemp(prefix="wf-pyc-")}
    # bash in the container. On Windows (the unit tests) `bash` on PATH may be
    # System32\bash.exe, WSL's launcher, not a shell; Git's sh.exe is the POSIX one.
    sh = "bash" if POSIX else shutil.which("sh")
    argv = [sh, "-c", command] if sh else command
    p = subprocess.Popen(argv, cwd=ws, shell=isinstance(argv, str), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=POSIX, env=env)
    timed_out = False
    try:
        out, _ = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_tree(p)
        out, _ = p.communicate()
    finally:
        kill_tree(p)
        shutil.rmtree(env["PYTHONPYCACHEPREFIX"], ignore_errors=True)
    return (None if timed_out else p.returncode), out.decode("utf-8", errors="replace")


def tail(text, n=40):
    return "\n".join(text.strip().splitlines()[-n:])


def main():
    spec = json.load(open(sys.argv[1]))
    ws = sys.argv[2] if len(sys.argv) > 2 else "/workspace"
    problems = []
    timeout = int(spec.get("testTimeoutSec", 300))

    files = test_files(ws, spec.get("testFiles") or [])
    texts = [open(os.path.join(ws, f), encoding="utf-8", errors="replace").read() for f in files]
    missing = [t for t in spec.get("requiredTokens", []) if not any(token_regex(t).search(x) for x in texts)]
    if not files:
        where = ", ".join(spec["testFiles"]) if spec.get("testFiles") else 'a path containing "test" or "spec"'
        problems.append(f"no test files found (looked for {where}).")
    elif missing:
        problems.append(
            "no test is named for scenario(s) " + ", ".join(missing)
            + f" — put the id in the test's name, e.g. test_{missing[0]}_<what>."
        )

    tests = None
    command = (spec.get("testCommand") or "").strip()
    if not command:
        problems.append("there is no test command to run.")
    else:
        rc, out = run(command, ws, timeout)
        count = None
        if spec.get("testCountPattern"):
            m = re.search(spec["testCountPattern"], out, re.M)
            count = int(m.group(1)) if m else 0
        tests = {"rc": rc, "timedOut": rc is None, "count": count, "tail": tail(out)}
        if rc is None:
            problems.append(f"the test suite did not finish within {timeout} seconds (a server left running, or a test waiting forever?).")
        elif rc != 0:
            problems.append(f"the test suite failed (`{command}` exited {rc}).")
        elif count == 0:
            problems.append(f"the test suite ran no tests (`{command}`).")

    checks = []
    for c in spec.get("checks", []):
        rc, out = run(c["command"], ws, 120)
        checks.append({"name": c["name"], "ok": rc == 0, "tail": tail(out, 20)})
        if rc != 0:
            problems.append(f'the "{c["name"]}" check failed' + (" (timed out)." if rc is None else "."))

    report = {"ok": not problems, "problems": problems, "missingTokens": missing, "checks": checks}
    if tests is not None:
        report["tests"] = tests
    print(json.dumps(report))
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
