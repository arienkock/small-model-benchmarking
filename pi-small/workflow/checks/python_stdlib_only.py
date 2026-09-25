#!/usr/bin/env python3
"""python_stdlib_only.py — a task check: Python code imports only the standard library.

Not part of the harness: a task opts in from its task.json, e.g.

    "checks": [{"name": "Python standard library only",
                "command": "python3 /opt/pi-small/workflow/checks/python_stdlib_only.py"}]

Run from the workspace. Parses every .py file (it never imports them) and fails
on any top-level import that is neither in sys.stdlib_module_names nor a module
of the workspace itself. Prints one line per violation; exit 0 when clean.
"""
import ast
import os
import sys

SKIP_DIRS = {".home", ".workflow", "__pycache__", ".git", "node_modules", ".venv", "venv"}


def main():
    ws = sys.argv[1] if len(sys.argv) > 1 else "."
    local = set()
    for root, dirs, files in os.walk(ws):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        local.update(f[:-3] for f in files if f.endswith(".py") and not f.startswith("._"))
        local.update(dirs)
    allowed = set(sys.stdlib_module_names) | local | {"__future__"}
    bad = []
    for root, dirs, files in os.walk(ws):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            # ._x.py: macOS AppleDouble metadata a tar from a Mac leaves behind, not code.
            if not f.endswith(".py") or f.startswith("._"):
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, ws).replace(os.sep, "/")
            try:
                tree = ast.parse(open(path, encoding="utf-8", errors="replace").read(), rel)
            except SyntaxError as e:
                bad.append(f"{rel}: syntax error on line {e.lineno}")
                continue
            except ValueError as e:  # e.g. null bytes: not Python source at all
                bad.append(f"{rel}: not Python source ({e})")
                continue
            for node in ast.walk(tree):
                mods = [a.name for a in node.names] if isinstance(node, ast.Import) else (
                    [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module else [])
                for m in mods:
                    if m.split(".")[0] not in allowed:
                        bad.append(f"{rel} imports {m!r}, which is not in the Python standard library")
    for line in bad:
        print(line)
    if not bad:
        print("only standard-library and local imports")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
