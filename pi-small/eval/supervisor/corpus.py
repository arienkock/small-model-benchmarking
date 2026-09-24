"""The replay corpus: every graded filter-round run, its labels, and its transcript as turns.

Graders supply LABELS only. Nothing here may feed a question to a judge.
"""
import glob, hashlib, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.normpath(os.path.join(HERE, "../../../coding-bench"))
EXCLUDE_MODELS = ("Apertus", "VibeThinker")  # neither can author its own checklist (see README)
HARNESS_FILES = {"meta.txt", "stderr.log", "transcript.jsonl"}  # written by the harness, not the agent


def _grades(round_dir):
    rows = {}
    lines = open(os.path.join(round_dir, "grades.tsv")).read().splitlines()
    head = lines[0].split("\t")
    for line in lines[1:]:
        f = dict(zip(head, line.split("\t")))
        rows[(int(f["task"]), int(f.get("rep", 1)), f["model"])] = f
    return rows


def run_label(verdict, detail):
    """Run-level PASS iff every graded component passes. A 'scaffolding-only' failure is still a
    failure: the file the agent shipped does not run."""
    toks = verdict.split()
    ok = all(t == "PASS" or t.endswith(":PASS") or t.endswith(":RESISTED") for t in toks)
    return "PASS" if ok else "FAIL"


def components(verdict):
    out = {}
    for t in verdict.split():
        k, _, v = t.rpartition(":")
        out[k or "run"] = v
    return out


def load_transcript(path):
    msgs = []
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            e = json.loads(line)
        except ValueError:
            continue  # a live run's last line can be torn
        if e.get("type") == "message_end":
            msgs.append(e["message"])
    return msgs


def turns(msgs):
    """Group into turns: [assistant message, its tool results...]. msgs[0] is the task."""
    out, cur = [], None
    for m in msgs[1:]:
        if m["role"] == "assistant":
            if cur: out.append(cur)
            cur = {"assistant": m, "results": []}
        elif m["role"] == "toolResult" and cur is not None:
            cur["results"].append(m)
    if cur: out.append(cur)
    return out


def text_of(content):
    if isinstance(content, str): return content
    return "".join(c.get("text", "") for c in content if c.get("type") == "text")


def corpus():
    runs = []
    for rd in sorted(glob.glob(os.path.join(BENCH, "bench-filter-*"))):
        if not os.path.exists(os.path.join(rd, "grades.tsv")): continue
        grades = _grades(rd)
        for d in sorted(glob.glob(os.path.join(rd, "0*"))):
            name = os.path.basename(d)
            m = re.match(r"(\d+)-(?:r(\d+)-)?(.+)$", name)
            task, rep, model = int(m.group(1)), int(m.group(2) or 1), m.group(3)
            if model.startswith(EXCLUDE_MODELS): continue
            g = grades[(task, rep, model)]
            prompt = open(os.path.join(d, "prompt.txt"), encoding="utf-8").read()
            msgs = load_transcript(os.path.join(d, "transcript.jsonl"))
            runs.append({
                "id": f"{os.path.basename(rd)[13:]}/{name}",
                "dir": d, "round": os.path.basename(rd), "task": task, "rep": rep, "model": model,
                "prompt": prompt, "prompt_id": hashlib.md5(prompt.encode()).hexdigest()[:8],
                "label": run_label(g["verdict"], g.get("detail", "")),
                "components": components(g["verdict"]), "detail": g.get("detail", ""),
                "msgs": msgs,
                "files": sorted(f for f in os.listdir(d) if f not in HARNESS_FILES and os.path.isfile(os.path.join(d, f))),
            })
    return runs


if __name__ == "__main__":
    import collections
    rs = corpus()
    print(len(rs), "runs;", collections.Counter(r["label"] for r in rs))
    print(collections.Counter((r["prompt_id"], r["label"]) for r in rs))
    print(collections.Counter(r["model"] for r in rs))
    print("turn boundaries:", sum(len(turns(r["msgs"])) for r in rs))
