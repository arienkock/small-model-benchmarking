"""Coverage audit: for each failing run, which graded requirement did it miss — and did the
model's own checklist (any of its 5) contain a check aimed at that requirement?

Requirement ids per task come from what the graders check (coding-bench/graders, grade-run.sh).
Which requirement a run failed is derived from its grade row. Whether a generated check is
"aimed at" a requirement is a hand judgement, recorded in labels/check-targets.json, made from the
check text alone before looking at any judge output.
"""
import json, os
from corpus import corpus
from probes import checklists

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_K = 3   # same checklists every judge is scored on

REQS = {
    "78820dee": {"D-args": "fn receives the latest call's arguments (spread)",
                 "D-cancel": "a new call cancels the pending one: one fn call per burst",
                 "D-runs": "the shipped debounce.ts loads and its self-test runs/prints 'all tests passed'",
                 "D-exists": "debounce.ts exists"},
    "627e146d": {"T-429": "server: 5x200 then 429 with Retry-After on the 6th",
                 "T-logic": "throttle: at most maxPerWindow calls per window, resets next window",
                 "T-runs": "throttle.ts loads and its self-test runs",
                 "T-exists": "server.py and throttle.ts exist"},
    "f3708b76": {"A-server": "server: 200 {average_speed: 48}; 400 on hours=0",
                 "A-logic": "averageSpeed rounds to 2 decimals; isPositiveNumber correct",
                 "A-runs": "averageSpeed.ts loads and its self-test runs",
                 "A-exists": "server.py and averageSpeed.ts exist"},
    "2fa8e50b": {"B-headers": "Content-Type and Content-Length correct",
                 "B-status": "200 on /api/books, 404 elsewhere",
                 "B-body": "valid JSON body with the 2 books"},
}


def failed_reqs(r):
    c, d = r["components"], r["detail"]
    out = set()
    pid = r["prompt_id"]
    if pid == "78820dee":
        v = c.get("run", "") or ""
        vals = set(c.values())
        if "MISSING" in vals: out.add("D-exists")
        if vals & {"LOAD_FAIL", "RUN_FAIL", "NO_SIGNAL"} or c.get("debounce.pkg") == "FAIL": out.add("D-runs")
        if "LOGIC_FAIL" in vals or c.get("debounce.algo") == "FAIL":
            out.add("D-cancel" if "exactly 1 call" in d or "fn should be called" in d else "D-args")
        if "logic:LOGIC_FAIL" in d and not out & {"D-args", "D-cancel"}:
            out.add("D-cancel" if "exactly 1 call" in d else "D-args")
    elif pid in ("627e146d", "f3708b76"):
        p, k = ("T", "throttle") if pid == "627e146d" else ("A", "avgSpeed")
        s = c.get("server")
        if s == "MISSING" or c.get(k) == "MISSING": out.add(f"{p}-exists")
        if s in ("FAIL", "PARTIAL", "NO_LISTENER", "SERVER_DIED"): out.add(f"{p}-429" if p == "T" else "A-server")
        t = c.get(k) or c.get(f"{k}.pkg")
        if t in ("LOAD_FAIL", "RUN_FAIL", "NO_SIGNAL", "FAIL"): out.add(f"{p}-runs")
        if c.get(k) == "LOGIC_FAIL" or c.get(f"{k}.algo") == "FAIL" or "logic:LOGIC_FAIL" in d: out.add(f"{p}-logic")
    elif pid == "2fa8e50b":
        for part, req in (("books.headers", "B-headers"), ("books.status", "B-status"), ("books.body", "B-body")):
            if c.get(part) == "FAIL": out.add(req)
    return sorted(out)


def audit():
    targets = json.load(open(os.path.join(HERE, "labels", "check-targets.json")))
    cls = checklists()
    rows = []
    for r in corpus():
        if r["label"] != "FAIL": continue
        fr = failed_reqs(r)
        for cl in cls.get((r["model"], r["prompt_id"]), []):
            if cl["k"] >= MAX_K: continue
            aimed = set()
            for i, _ in enumerate(cl["checks"]):
                aimed |= set(targets.get(f"{r['model']}|{r['prompt_id']}|{cl['k']}|{i}", []))
            rows.append({"run": r["id"], "k": cl["k"], "failed": fr, "covered": sorted(set(fr) & aimed)})
    return rows


if __name__ == "__main__":
    import collections
    rs = [r for r in corpus() if r["label"] == "FAIL"]
    print(collections.Counter(tuple(failed_reqs(r)) for r in rs))
    print("no requirement derived:", [r["id"] for r in rs if not failed_reqs(r)])


def summary():
    """Per model: share of failing-run sessions whose checklist aims at >=1 requirement that run
    failed; and per requirement, how many of the model's checklists aim at it at all."""
    import collections
    targets = json.load(open(os.path.join(HERE, "labels", "check-targets.json")))
    cls = checklists()
    rows = audit()
    by_model = collections.defaultdict(lambda: [0, 0])
    runs = {r["id"]: r for r in corpus()}
    for row in rows:
        m = runs[row["run"]]["model"]
        by_model[m][1] += 1; by_model[m][0] += bool(row["covered"])
    aim = collections.defaultdict(lambda: collections.Counter())
    n_cl = collections.Counter()
    for (m, pid), lst in cls.items():
        for cl in lst:
            if cl["k"] >= MAX_K: continue
            n_cl[(m, pid)] += 1
            got = set()
            for i, _ in enumerate(cl["checks"]):
                got |= set(targets.get(f"{m}|{pid}|{cl['k']}|{i}", []))
            for req in REQS[pid]: aim[(m, pid)][req] += req in got
    return {"sessions_covering_a_failed_requirement": {m: f"{a}/{b}" for m, (a, b) in sorted(by_model.items())},
            "checklists_aiming_at_each_requirement": {f"{m} {pid}": {req: f"{aim[(m, pid)][req]}/{n_cl[(m, pid)]}" for req in REQS[pid]} for (m, pid) in sorted(aim)}}


# Which failed requirements a GENERIC question's capsule would point the agent at. Fixed here,
# before looking at which questions fired: a capsule "points at" a requirement when acting on it
# would lead the agent to that requirement.
GENERIC_POINTS_AT = {
    "G6": {"D-exists", "T-exists", "A-exists"},
    "G7": {"D-runs", "T-runs", "A-runs"},
    "G8": {"D-runs", "T-runs", "A-runs", "T-429", "A-server", "B-status", "B-body", "B-headers"},
    "G9": {"D-runs", "T-429", "A-server", "B-status", "B-body", "B-headers"},
    "G10": set(),   # "claims are backed by output" names no requirement
    "G11": {"D-args", "D-cancel", "T-logic", "A-logic", "T-429", "A-server", "B-headers", "B-status", "B-body"},
}


def attribution(judge, cond="TE", max_k=3):
    """For every session a capsule would fire on (v > 0.5): does the TOP firing check point at a
    requirement the run actually failed? Sessions are (run, k): generic bank + checklist k."""
    import score
    targets = json.load(open(os.path.join(HERE, "labels", "check-targets.json")))
    rs = {r["id"]: r for r in corpus()}
    vs = [e for e in score.load(judge) if e["part"] == "finals" and e["cond"] == cond and score.v_of(e) is not None]
    by = {}
    for e in vs: by.setdefault(e["run"], []).append(e)
    out = {"FAIL": {"fired": 0, "right": 0, "wrong": 0, "not_fired": 0}, "PASS": {"fired": 0, "not_fired": 0},
           "top_is_generic": 0, "top_is_generated": 0}
    for run, es in by.items():
        r = rs[run]; fr = set(failed_reqs(r))
        ks = sorted({e["qid"].split(":")[1] for e in es if e["qid"].startswith("gen:") and int(e["qid"].split(":")[1]) < max_k})
        for k in ks or [None]:
            sess = [e for e in es if e["qid"].startswith("G") or e["qid"].split(":")[1] == k]
            top = max(sess, key=score.v_of)
            if score.v_of(top) <= score.TH:
                out[r["label"]]["not_fired"] += 1; continue
            out[r["label"]]["fired"] += 1
            out["top_is_generic" if top["qid"].startswith("G") else "top_is_generated"] += 1
            if r["label"] == "FAIL":
                if top["qid"].startswith("G"): pts = GENERIC_POINTS_AT[top["qid"]]
                else:
                    _, kk, i = top["qid"].split(":")
                    pts = set(targets.get(f"{r['model']}|{r['prompt_id']}|{kk}|{i}", []))
                out["FAIL"]["right" if pts & fr else "wrong"] += 1
    return out
