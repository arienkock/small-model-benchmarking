#!/usr/bin/env python3
"""session-summary.py — a fast per-turn readout of one workflow step's session.

    python3 tools/session-summary.py workflow-runs/<run>/steps/<step>

A step directory holds the prompt and the harness's own verdict, but not the
session itself: that is pi's own JSONL, one file per step (every step is a
fresh newSession() — see ../lib/workflow-command.ts), under
<run>/home/.pi/agent/sessions/*/*.jsonl. This finds the right file by matching
the step's [step_start, step_run) window in <run>/events.jsonl against each
session file's header timestamp, then prints one turn per assistant message:
the tool it called, a short excerpt of the arguments, whether the result
errored (first/last line only — never the full output), the stop reason,
token usage, wall time since the previous message, and the length of its
reasoning in characters. Never the reasoning text itself: quoting a local
model's thinking here would look like a reasoning_extraction probe.
"""
import glob
import json
import os
import sys
from datetime import datetime

ARG_EXCERPT_LEN = 150
RESULT_LINE_LEN = 200
WINDOW_SLOP_MS = 0  # step_start/step_run bracket the session's header exactly; no slop needed


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def read_jsonl(path):
    out = []
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue  # a live run's last line can be torn
    return out


def step_window(run_dir, step_name):
    """[start, end) for the step's agent session, from events.jsonl. end is None
    if the step is still running (no step_run yet)."""
    events_path = os.path.join(run_dir, "events.jsonl")
    if not os.path.exists(events_path):
        return None, None, "no events.jsonl in the run directory"
    start = end = None
    for e in read_jsonl(events_path):
        if e.get("step") != step_name:
            continue
        if e.get("type") == "step_start":
            start = parse_ts(e["ts"])
        elif e.get("type") == "step_run":
            end = parse_ts(e["ts"])
    if start is None:
        return None, None, "no step_start event for this step (a check-only step, e.g. final-check, runs no agent session)"
    return start, end, None


def find_session_file(run_dir, start, end):
    sessions_root = os.path.join(run_dir, "home", ".pi", "agent", "sessions")
    candidates = []
    for path in glob.glob(os.path.join(sessions_root, "*", "*.jsonl")):
        try:
            header = json.loads(open(path, encoding="utf-8").readline())
        except (ValueError, OSError):
            continue
        if header.get("type") != "session":
            continue
        ts = parse_ts(header["timestamp"])
        lo = start.timestamp() * 1000 - WINDOW_SLOP_MS
        hi = (end.timestamp() * 1000 + WINDOW_SLOP_MS) if end else float("inf")
        if lo <= ts.timestamp() * 1000 <= hi:
            candidates.append((ts, path))
    candidates.sort()
    return candidates


def excerpt(obj, n=ARG_EXCERPT_LEN):
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return s if len(s) <= n else s[:n] + "…"


def result_lines(tool_result):
    if tool_result is None:
        return None
    parts = [c.get("text", "") for c in tool_result["message"].get("content", []) if c.get("type") == "text"]
    text = "\n".join(parts).strip()
    if not text:
        return "(empty)", "(empty)"
    lines = [l.strip() for l in text.splitlines() if l.strip()] or [""]
    trunc = lambda l: l if len(l) <= RESULT_LINE_LEN else l[:RESULT_LINE_LEN] + "…"
    return trunc(lines[0]), trunc(lines[-1])


def summarize(session_path):
    entries = read_jsonl(session_path)
    if not entries or entries[0].get("type") != "session":
        print(f"  {session_path}: not a session file (missing header)", file=sys.stderr)
        return

    tool_results = {}
    for e in entries:
        if e.get("type") == "message" and e["message"].get("role") == "toolResult":
            tool_results[e["message"]["toolCallId"]] = e

    prev_ts = parse_ts(entries[0]["timestamp"])
    turn = 0
    for e in entries:
        if e.get("type") != "message":
            continue
        msg = e["message"]
        ts = parse_ts(e["timestamp"])
        if msg["role"] != "assistant":
            prev_ts = ts
            continue

        turn += 1
        elapsed_ms = round((ts - prev_ts).total_seconds() * 1000)
        prev_ts = ts
        content = msg.get("content", [])
        thinking_chars = sum(len(c.get("thinking", "")) for c in content if c.get("type") == "thinking")
        tool_calls = [c for c in content if c.get("type") == "toolCall"]
        usage = msg.get("usage") or {}
        stop = msg.get("stopReason", "?")
        err = f" error={msg['errorMessage']!r}" if msg.get("errorMessage") else ""

        print(
            f"turn {turn}: stop={stop}{err} "
            f"tokens=in{usage.get('input', '?')}/out{usage.get('output', '?')}/reasoning{usage.get('reasoning', 0)} "
            f"time={elapsed_ms}ms reasoning_chars={thinking_chars}"
        )
        if not tool_calls:
            text = "".join(c.get("text", "") for c in content if c.get("type") == "text").strip()
            print(f"  (no tool call){' — ' + text[:RESULT_LINE_LEN] if text else ''}")
            continue
        for tc in tool_calls:
            tr = tool_results.get(tc["id"])
            first, last = result_lines(tr) if tr else (None, None)
            if tr is None:
                status = "no result (session ended before the tool returned)"
            else:
                status = "ERROR" if tr["message"].get("isError") else "ok"
            line = f"  {tc['name']} args={excerpt(tc.get('arguments', {}))} -> {status}"
            if first is not None:
                line += f" first={first!r} last={last!r}" if first != last else f" first=last={first!r}"
            print(line)


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    step_dir = os.path.abspath(sys.argv[1])
    step_name = os.path.basename(step_dir)
    run_dir = os.path.dirname(os.path.dirname(step_dir))
    if not os.path.isdir(step_dir):
        sys.exit(f"no such step directory: {step_dir}")

    start, end, why_no_window = step_window(run_dir, step_name)
    if start is None:
        print(f"{step_name}: {why_no_window}", file=sys.stderr)
        sys.exit(0)

    candidates = find_session_file(run_dir, start, end)
    if not candidates:
        sys.exit(
            f"{step_name}: no session file found under {run_dir}/home/.pi/agent/sessions "
            f"in [{start.isoformat()}, {end.isoformat() if end else 'now'}) — wrong run dir, or fetched without the home/ tree?"
        )
    if len(candidates) > 1:
        print(
            f"{step_name}: {len(candidates)} session files fall in this step's window; using the earliest "
            f"({os.path.basename(candidates[0][1])}). Others: {', '.join(os.path.basename(p) for _, p in candidates[1:])}",
            file=sys.stderr,
        )
    session_path = candidates[0][1]
    print(f"{step_name} — {os.path.relpath(session_path, run_dir)}")
    summarize(session_path)


if __name__ == "__main__":
    main()
