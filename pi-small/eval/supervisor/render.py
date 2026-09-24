"""Render a run (or a prefix of it) as the text state a judge sees: TASK, ACTIONS, EVIDENCE.

Task-agnostic by construction: it knows tool kinds (bash/read/write/edit), never tasks.
"""
from corpus import text_of, turns

ACTIONS_BUDGET = 14000   # chars; ~4k tokens. Kev serves 8192 tokens for state + one question.
EVIDENCE_BUDGET = 5000


def cut(s, n):
    s = s or ""
    if len(s) <= n: return s
    h = n // 2
    return s[:h] + f"\n[... {len(s) - n} chars cut ...]\n" + s[-h:]


def render_call(c):
    a = c.get("arguments") or {}
    if c["name"] == "bash":
        return "$ " + cut(str(a.get("command", "")), 800)
    if c["name"] == "write":
        body = str(a.get("content", ""))
        return f"write {a.get('path')} ({len(body)} chars):\n" + cut(body, 1500)
    if c["name"] == "edit":
        edits = a.get("edits") or [{"oldText": a.get("oldText"), "newText": a.get("newText")}]
        return f"edit {a.get('path')}:\n" + "\n".join(
            f"- replace:\n{cut(str(e.get('oldText')), 300)}\n  with:\n{cut(str(e.get('newText')), 300)}" for e in edits)
    if c["name"] == "read":
        return f"read {a.get('path')}"
    return f"{c['name']} {cut(str(a), 300)}"


def render_turn(i, t):
    out = [f"--- turn {i + 1}"]
    said = text_of(t["assistant"]["content"]).strip()
    if said: out.append("agent: " + cut(said, 700))
    calls = [c for c in t["assistant"]["content"] if c.get("type") == "toolCall"]
    for c, r in zip(calls, t["results"] + [None] * len(calls)):
        out.append(render_call(c))
        if r is not None:
            out.append("output:\n" + cut(text_of(r["content"]).rstrip(), 800))
    if t["assistant"].get("stopReason") == "length":
        out.append("[response cut off at the token limit]")
    return "\n".join(out)


def render_actions(ts):
    blocks = [render_turn(i, t) for i, t in enumerate(ts)]
    total = sum(len(b) + 1 for b in blocks)
    if total <= ACTIONS_BUDGET:
        return "\n".join(blocks)
    # keep the first turn and as many of the latest as fit; the middle is what gets dropped
    head, tail, used = blocks[:1], [], len(blocks[0])
    for b in reversed(blocks[1:]):
        if used + len(b) > ACTIONS_BUDGET - 80: break
        tail.insert(0, b); used += len(b)
    dropped = len(blocks) - 1 - len(tail)
    if not tail:  # the latest turn alone is over budget
        tail = [cut(blocks[-1], ACTIONS_BUDGET - len(blocks[0]) - 80)]; dropped = len(blocks) - 2
    return "\n".join(head + [f"[... {dropped} turns omitted ...]"] + tail)


def state(run, upto=None, evidence=None):
    ts = turns(run["msgs"])
    ts = ts if upto is None else ts[:upto]
    s = "TASK:\n" + run["prompt"].strip() + "\n\nACTIONS:\n" + render_actions(ts)
    if evidence:
        s += "\n\nEVIDENCE (gathered by the supervisor after the agent finished):\n" + cut(evidence, EVIDENCE_BUDGET)
    return s


if __name__ == "__main__":
    import sys
    from corpus import corpus
    rs = corpus()
    lens = sorted(len(state(r)) for r in rs)
    print("final state chars: min", lens[0], "median", lens[len(lens) // 2], "max", lens[-1])
    r = next(x for x in rs if x["id"].endswith(sys.argv[1])) if len(sys.argv) > 1 else rs[0]
    print(state(r))
